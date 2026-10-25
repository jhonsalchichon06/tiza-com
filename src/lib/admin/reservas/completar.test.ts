import { describe, expect, it } from "vitest";
import type { ErrorApi } from "../../errores";
import { crearBdDoble, type Guion } from "../../perfil/__dobles__/bd-doble";
import { completarReserva, evaluarCompletar, MENSAJE_AUN_NO_EMPIEZA, MENSAJES_NO_COMPLETABLE } from "./completar";

const ID = "33333333-3333-4333-8333-333333333333";
const fila = (estado: string, yaEmpezo: boolean) => ({ id: ID, estado, yaEmpezo });

const montar = (guion: Guion) => {
  const doble = crearBdDoble(guion);
  return { doble, completar: (id = ID) => completarReserva({ reservaId: id }, { base: () => doble.base }) };
};

async function error(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("se esperaba un error");
}

describe("evaluarCompletar (función pura)", () => {
  it("solo una confirmada que ya empezó da ok", () => {
    expect(evaluarCompletar({ estadoEfectivo: "confirmada", yaEmpezo: true })).toBe("ok");
    expect(evaluarCompletar({ estadoEfectivo: "confirmada", yaEmpezo: false })).toBe(MENSAJE_AUN_NO_EMPIEZA);
  });

  it("cada estado tiene su propio mensaje", () => {
    const mensajes = (["pendiente", "cancelada", "expirada", "completada"] as const).map((e) => evaluarCompletar({ estadoEfectivo: e, yaEmpezo: true }));
    expect(new Set(mensajes).size).toBe(4);
    expect(mensajes).toEqual([MENSAJES_NO_COMPLETABLE.pendiente, MENSAJES_NO_COMPLETABLE.cancelada, MENSAJES_NO_COMPLETABLE.expirada, MENSAJES_NO_COMPLETABLE.completada]);
    expect(MENSAJES_NO_COMPLETABLE.pendiente).toMatch(/primero debe aprobarse el pago/);
  });
});

describe("completarReserva", () => {
  it("una confirmada iniciada pasa a completada, con FOR UPDATE, y solo escribe estado y actualizada_en", async () => {
    const m = montar({ reservas: [[fila("confirmada", true)], [{ id: ID }]] });
    const r = await m.completar();
    expect(r).toEqual({ reserva: { id: ID, estado: "completada" } });
    expect(m.doble.estado.expiraciones).toBe(1); // la transacción empieza con expirarVencidas
    expect(m.doble.bloqueos()).toEqual(["reservas"]);
    const escrituras = m.doble.escrituras();
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].tabla).toBe("reservas");
    expect(Object.keys(escrituras[0].set!).sort()).toEqual(["actualizadaEn", "estado"]);
    expect(escrituras[0].set).toMatchObject({ estado: "completada" });
    expect(escrituras[0].donde?.params).toContain(ID);
  });

  it("una confirmada futura da 409 «todavía no empieza» sin UPDATE", async () => {
    const m = montar({ reservas: [[fila("confirmada", false)]] });
    expect(await error(m.completar())).toMatchObject({ status: 409, message: "El servicio todavía no empieza." });
    expect(m.doble.escrituras()).toEqual([]);
  });

  it.each(["pendiente", "cancelada", "expirada", "completada"] as const)("%s da 409 con su mensaje y sin escribir", async (estado) => {
    const m = montar({ reservas: [[fila(estado, true)]] });
    expect(await error(m.completar())).toMatchObject({ status: 409, message: MENSAJES_NO_COMPLETABLE[estado] });
    expect(m.doble.escrituras()).toEqual([]);
  });

  it("una reserva inexistente da 404", async () => {
    const m = montar({ reservas: [[]] });
    expect(await error(m.completar())).toMatchObject({ status: 404 });
    expect(m.doble.escrituras()).toEqual([]);
  });

  it("un id sin formato de uuid da 404 sin abrir la transacción", async () => {
    const m = montar({});
    expect(await error(m.completar("abc"))).toMatchObject({ status: 404 });
    expect(m.doble.estado.transacciones).toBe(0);
  });

  it("no toca pagos, membresías ni equipos", async () => {
    const m = montar({ reservas: [[fila("confirmada", true)], [{ id: ID }]] });
    await m.completar();
    expect(m.doble.sentencias.map((s) => s.tabla).every((t) => t === "reservas")).toBe(true);
  });
});
