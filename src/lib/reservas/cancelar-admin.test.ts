import { describe, expect, it } from "vitest";
import type { ErrorApi } from "../errores";
import { crearTxDoble, type Guion } from "../pagos/__dobles__/tx-doble";
import { cancelarReservaComoAdmin } from "./cancelar-admin";

const ID = "33333333-3333-4333-8333-333333333333";
const PAGO = "11111111-1111-4111-8111-111111111111";
const fila = (estado: string) => ({ id: ID, estado, pagoId: PAGO, canceladaPor: null });

const montar = (guion: Guion) => {
  const doble = crearTxDoble(guion);
  return { ...doble, cancelar: (id = ID) => cancelarReservaComoAdmin({ reservaId: id }, { base: () => doble.base }) };
};

async function error(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("se esperaba un error");
}

describe("cancelarReservaComoAdmin", () => {
  it("cancela una pendiente con cancelada_por = admin, bloqueándola, y no toca pagos ni membresías", async () => {
    const m = montar({ reservas: [[fila("pendiente")], [{ ...fila("cancelada"), canceladaPor: "admin" }]] });
    const r = await m.cancelar();
    expect(r.reserva).toEqual({ id: ID, estado: "cancelada", cancelada_por: "admin", pago_id: PAGO });
    expect(m.bloqueos()).toEqual(["reservas"]);
    expect(m.escrituras().map((s) => s.tabla)).toEqual(["reservas"]);
    expect(m.escrituras()[0].set).toMatchObject({ estado: "cancelada", canceladaPor: "admin" });
    expect(m.estado.expiraciones).toBe(1); // la transacción empieza marcando las vencidas
  });

  it("una expirada da 409 «ya expiró» sin escribir", async () => {
    const m = montar({ reservas: [[fila("expirada")]] });
    expect(await error(m.cancelar())).toMatchObject({ status: 409, message: expect.stringMatching(/ya expiró/) });
    expect(m.escrituras()).toEqual([]);
  });

  it("una confirmada da 409 sin escribir", async () => {
    const m = montar({ reservas: [[fila("confirmada")]] });
    expect(await error(m.cancelar())).toMatchObject({ status: 409, message: expect.stringMatching(/confirmada/) });
    expect(m.escrituras()).toEqual([]);
  });

  it.each(["cancelada", "completada"])("una %s da 409 sin escribir", async (estado) => {
    const m = montar({ reservas: [[fila(estado)]] });
    expect(await error(m.cancelar())).toMatchObject({ status: 409 });
    expect(m.escrituras()).toEqual([]);
  });

  it("una reserva inexistente da 404", async () => {
    const m = montar({ reservas: [[]] });
    expect(await error(m.cancelar())).toMatchObject({ status: 404 });
  });

  it("un id sin formato de uuid da 404 sin consultar", async () => {
    const m = montar({});
    expect(await error(m.cancelar("abc"))).toMatchObject({ status: 404 });
    expect(m.sentencias).toEqual([]);
  });
});

describe("cancelarReservaComoAdmin: crédito en horas (ítem 14)", () => {
  const cancelada = { ...fila("cancelada"), canceladaPor: "admin" };

  it("guarda cancelada_en en el mismo UPDATE y devuelve los usos reservado, sin generar ningún lote", async () => {
    const m = montar({ reservas: [[fila("pendiente")], [cancelada]], creditos: [[{ id: "l1" }], [{ id: "l1", horas: "2" }]] });
    await m.cancelar();
    expect(m.escrituras()).toHaveLength(1);
    expect(Object.keys(m.escrituras()[0].set ?? {})).toContain("canceladaEn");
    const e = m.ejecuciones();
    expect(e).toHaveLength(2);
    expect(e[0].texto).toContain("FOR UPDATE");
    expect(e[1].params).toEqual([ID, "reservado"]);
    expect(e.some((s) => s.texto?.includes("INSERT INTO") || s.texto?.startsWith('UPDATE "reservas"'))).toBe(false);
  });

  it("sin crédito usado solo bloquea sin encontrar lotes", async () => {
    const m = montar({ reservas: [[fila("pendiente")], [cancelada]] });
    await m.cancelar();
    expect(m.ejecuciones()).toHaveLength(1);
  });

  it("si la reserva no se puede cancelar no toca el crédito", async () => {
    const m = montar({ reservas: [[fila("confirmada")]] });
    await error(m.cancelar());
    expect(m.ejecuciones()).toEqual([]);
  });
});
