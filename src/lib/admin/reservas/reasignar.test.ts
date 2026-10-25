import { describe, expect, it } from "vitest";
import type { ErrorApi } from "../../errores";
import { crearBdDoble, type Guion, type Sentencia } from "../../perfil/__dobles__/bd-doble";
import { reasignarReserva, MENSAJE_EQUIPO_INACTIVO, MENSAJE_EQUIPO_OCUPADO, MENSAJE_MISMO_EQUIPO } from "./reasignar";

const ID = "33333333-3333-4333-8333-333333333333";
const CHOQUE = Object.assign(new Error("exclusion"), { code: "23P01" });
const CHOQUE_ENVUELTO = Object.assign(new Error("Failed query"), { cause: { code: "23P01" } });

const reserva = (estado = "confirmada", equipoId = 1) => [{ id: ID, estado, equipoId }];

function montar(guion: Guion, opciones: { exigirActivo?: boolean; falloEn?: (s: Sentencia) => Error | undefined } = {}) {
  const doble = crearBdDoble(guion, { falloEn: opciones.falloEn });
  return {
    doble,
    reasignar: (cuerpo: unknown = { equipo_id: 2 }, id = ID) =>
      reasignarReserva({ reservaId: id, cuerpo }, { base: () => doble.base, exigirActivo: opciones.exigirActivo }),
  };
}

async function error(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("se esperaba un error");
}

const EQUIPO_2 = [{ id: 2, activo: true }];

describe("reasignarReserva: éxito", () => {
  it("mueve la reserva al equipo libre y solo escribe equipo_id y actualizada_en, dentro de un savepoint", async () => {
    const m = montar({ reservas: [reserva(), [{ id: ID, estado: "confirmada", equipoId: 2 }]], equipos: [EQUIPO_2] });
    const r = await m.reasignar();
    expect(r).toEqual({ reserva: { id: ID, estado: "confirmada", equipo_id: 2 } });
    expect(m.doble.estado.expiraciones).toBe(1);
    expect(m.doble.bloqueos()).toEqual(["reservas"]);
    expect(m.doble.estado.savepoints).toBe(1);
    const [escritura] = m.doble.escrituras();
    expect(Object.keys(escritura.set!).sort()).toEqual(["actualizadaEn", "equipoId"]);
    expect(escritura.set).toMatchObject({ equipoId: 2 });
    expect(escritura.donde?.params).toContain(ID);
  });

  it("una pendiente vigente también se puede reasignar", async () => {
    const m = montar({ reservas: [reserva("pendiente"), [{ id: ID, estado: "pendiente", equipoId: 2 }]], equipos: [EQUIPO_2] });
    expect((await m.reasignar()).reserva.estado).toBe("pendiente");
  });

  it("exigirActivo = false acepta un equipo inactivo (solo pruebas contra la rama)", async () => {
    const m = montar({ reservas: [reserva(), [{ id: ID, estado: "confirmada", equipoId: 2 }]], equipos: [[{ id: 2, activo: false }]] }, { exigirActivo: false });
    expect((await m.reasignar()).reserva.equipo_id).toBe(2);
  });
});

describe("reasignarReserva: equipo ocupado", () => {
  it.each([
    ["23P01 directo", CHOQUE],
    ["23P01 envuelto en cause", CHOQUE_ENVUELTO],
  ])("%s → 409 equipo_ocupado sin otro efecto", async (_nombre, fallo) => {
    const m = montar({ reservas: [reserva()], equipos: [EQUIPO_2] }, { falloEn: (s) => (s.tipo === "update" ? (fallo as Error) : undefined) });
    const e = await error(m.reasignar());
    expect(e).toMatchObject({ status: 409, codigo: "equipo_ocupado", message: MENSAJE_EQUIPO_OCUPADO });
    expect(m.doble.escrituras()).toHaveLength(1); // el único intento, que la base rechazó
    expect(m.doble.estado.savepoints).toBe(1);
  });

  it("otro error de la base se propaga tal cual", async () => {
    const raro = Object.assign(new Error("se cayó"), { code: "57P01" });
    const m = montar({ reservas: [reserva()], equipos: [EQUIPO_2] }, { falloEn: (s) => (s.tipo === "update" ? raro : undefined) });
    expect(await error(m.reasignar())).toBe(raro);
  });
});

describe("reasignarReserva: rechazos", () => {
  it("equipo inexistente → 422", async () => {
    const m = montar({ reservas: [reserva()], equipos: [[]] });
    expect(await error(m.reasignar({ equipo_id: 99 }))).toMatchObject({ status: 422, message: MENSAJE_EQUIPO_INACTIVO });
    expect(m.doble.escrituras()).toEqual([]);
  });

  it("equipo inactivo → 422", async () => {
    const m = montar({ reservas: [reserva()], equipos: [[{ id: 2, activo: false }]] });
    expect(await error(m.reasignar())).toMatchObject({ status: 422, message: MENSAJE_EQUIPO_INACTIVO });
    expect(m.doble.escrituras()).toEqual([]);
  });

  it("el mismo equipo → 422 sin escribir", async () => {
    const m = montar({ reservas: [reserva("confirmada", 2)], equipos: [EQUIPO_2] });
    expect(await error(m.reasignar())).toMatchObject({ status: 422, message: MENSAJE_MISMO_EQUIPO });
    expect(m.doble.escrituras()).toEqual([]);
  });

  it.each(["completada", "cancelada", "expirada"])("una reserva %s → 409 con su estado, sin leer el equipo", async (estado) => {
    const m = montar({ reservas: [reserva(estado)], equipos: [EQUIPO_2] });
    const e = await error(m.reasignar());
    expect(e).toMatchObject({ status: 409 });
    expect(e.message).toContain(estado);
    expect(m.doble.lecturas().some((s) => s.tabla === "equipos")).toBe(false);
    expect(m.doble.escrituras()).toEqual([]);
  });

  it("una reserva inexistente → 404", async () => {
    const m = montar({ reservas: [[]] });
    expect(await error(m.reasignar())).toMatchObject({ status: 404 });
  });

  it("un id sin formato de uuid → 404 sin abrir la transacción", async () => {
    const m = montar({});
    expect(await error(m.reasignar({ equipo_id: 2 }, "abc"))).toMatchObject({ status: 404 });
    expect(m.doble.estado.transacciones).toBe(0);
  });

  it.each([["«2» como texto", { equipo_id: "2" }], ["cero", { equipo_id: 0 }], ["negativo", { equipo_id: -1 }], ["decimal", { equipo_id: 1.5 }], ["ausente", {}], ["sin cuerpo", null], ["no es objeto", 7]])(
    "equipo_id inválido (%s) → 422 sin abrir la transacción",
    async (_nombre, cuerpo) => {
      const m = montar({});
      expect(await error(m.reasignar(cuerpo))).toMatchObject({ status: 422 });
      expect(m.doble.estado.transacciones).toBe(0);
    },
  );
});
