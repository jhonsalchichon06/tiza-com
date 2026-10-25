import { describe, expect, it } from "vitest";
import { crearEjecutorDoble } from "./__doble__";
import { cancelarComoAdminConCredito, cancelarConCredito, consumirCreditoDeReservas, devolverCreditoDeReservas } from "./transiciones";

describe("consumirCreditoDeReservas", () => {
  it("sin ids no ejecuta nada", async () => {
    const { tx, sentencias } = crearEjecutorDoble();
    await consumirCreditoDeReservas(tx, []);
    expect(sentencias).toHaveLength(0);
  });

  it("pasa los usos reservado a consumido", async () => {
    const { tx, sentencias } = crearEjecutorDoble();
    await consumirCreditoDeReservas(tx, ["a", "b"]);
    expect(sentencias).toHaveLength(1);
    expect(sentencias[0].sql).toContain(`SET "estado" = 'consumido'`);
    expect(sentencias[0].sql).toContain(`"estado" = 'reservado'`);
    expect(sentencias[0].params).toEqual(["a", "b"]);
  });
});

describe("devolverCreditoDeReservas", () => {
  it("sin ids no hace nada", async () => {
    const { tx, sentencias } = crearEjecutorDoble();
    expect(await devolverCreditoDeReservas(tx, [], { estados: ["reservado"] })).toEqual([]);
    expect(sentencias).toHaveLength(0);
  });

  it("bloquea los lotes por id antes de devolver y no toca vence_en", async () => {
    const { tx, sentencias } = crearEjecutorDoble([[{ id: "l1" }], [{ id: "l1", horas: "2.5" }]]);
    const r = await devolverCreditoDeReservas(tx, ["a"], { estados: ["reservado"] });
    expect(r).toEqual([{ creditoId: "l1", horas: 2.5 }]);
    expect(sentencias).toHaveLength(2);
    expect(sentencias[0].sql).toContain('ORDER BY "id" FOR UPDATE');
    expect(sentencias[1].sql).toContain(`SET "estado" = 'devuelto'`);
    expect(sentencias[1].sql).toContain('"horas_disponibles" = c."horas_disponibles" + s."horas"');
    expect(sentencias.every((s) => !s.sql.includes("vence_en"))).toBe(true);
  });

  it("solo toca los usos del estado de partida pedido", async () => {
    const { tx, sentencias } = crearEjecutorDoble([[{ id: "l1" }], [{ id: "l1", horas: "1" }]]);
    await devolverCreditoDeReservas(tx, ["a"], { estados: ["reservado"] });
    expect(sentencias[1].params).toEqual(["a", "reservado"]);
    const dos = crearEjecutorDoble([[{ id: "l1" }], [{ id: "l1", horas: "1" }]]);
    await devolverCreditoDeReservas(dos.tx, ["a"], { estados: ["reservado", "consumido"] });
    expect(dos.sentencias[1].params).toEqual(["a", "reservado", "consumido"]);
  });

  it("si no hay usos que devolver no ejecuta la segunda sentencia", async () => {
    const { tx, sentencias } = crearEjecutorDoble([[]]);
    expect(await devolverCreditoDeReservas(tx, ["a"], { estados: ["reservado"] })).toEqual([]);
    expect(sentencias).toHaveLength(1);
  });
});

describe("cancelarConCredito", () => {
  it("devuelve reservado y consumido y genera el lote, sin volver a actualizar la reserva", async () => {
    const vence = new Date("2099-01-01T00:00:00Z");
    const { tx, sentencias } = crearEjecutorDoble([[{ id: "l1" }], [{ id: "l1", horas: "1.5" }], [{ id: "n1", horas_iniciales: "2", vence_en: vence }]]);
    const r = await cancelarConCredito(tx, { id: "r1" }, 3);
    expect(sentencias).toHaveLength(3);
    // Un segundo UPDATE de la misma fila (cancelada_en) obligaría a comprobar la clave foránea hacia pagos y bloquearía con aprobar.
    expect(sentencias.some((x) => x.sql.startsWith("UPDATE \"reservas\""))).toBe(false);
    expect(sentencias[1].params).toEqual(["r1", "reservado", "consumido"]);
    expect(sentencias[2].sql).toContain("INSERT INTO");
    expect(sentencias[2].params).toContain(3);
    expect(r.devueltoHoras).toBe(1.5);
    expect(r.generado).toEqual({ id: "n1", horas: 2, venceEn: vence });
  });

  it("sin usos y sin pago aprobado no genera ni devuelve", async () => {
    const { tx } = crearEjecutorDoble([[], []]);
    expect(await cancelarConCredito(tx, { id: "r1" }, 3)).toEqual({ generado: null, devuelto: [], devueltoHoras: 0 });
  });
});

describe("cancelarComoAdminConCredito", () => {
  it("devuelve solo los reservado y nunca genera un lote", async () => {
    const { tx, sentencias } = crearEjecutorDoble([[{ id: "l1" }], [{ id: "l1", horas: "2" }]]);
    const r = await cancelarComoAdminConCredito(tx, { id: "r1" });
    expect(r).toEqual([{ creditoId: "l1", horas: 2 }]);
    expect(sentencias).toHaveLength(2);
    expect(sentencias[1].params).toEqual(["r1", "reservado"]);
    expect(sentencias.some((s) => s.sql.includes("INSERT INTO"))).toBe(false);
  });
});
