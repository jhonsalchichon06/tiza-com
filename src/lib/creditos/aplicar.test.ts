import { describe, expect, it } from "vitest";
import { crearEjecutorDoble } from "./__doble__";
import { ErrorDeInvariante, horasCubiertas, leerCreditoParaReservar, tomarCredito } from "./aplicar";

const lote = (id: string, dias: number, horas: number) => ({ id, venceEn: new Date(Date.UTC(2099, 0, dias)), horasDisponibles: horas });

describe("leerCreditoParaReservar", () => {
  it("lee solo lotes vigentes con horas, ordenados por id y con FOR UPDATE", async () => {
    const { tx, sentencias } = crearEjecutorDoble([[{ id: "a", vence_en: new Date("2099-02-01T00:00:00Z"), horas_disponibles: "2.5" }]]);
    const lotes = await leerCreditoParaReservar(tx, "u1");
    expect(lotes).toEqual([{ id: "a", venceEn: new Date("2099-02-01T00:00:00Z"), horasDisponibles: 2.5 }]);
    expect(sentencias[0].sql).toContain('"vence_en" > now()');
    expect(sentencias[0].sql).toContain('"horas_disponibles" > 0');
    expect(sentencias[0].sql).toContain('ORDER BY "id" FOR UPDATE');
    expect(sentencias[0].params).toEqual(["u1"]);
  });

  it("sin lotes devuelve una lista vacía", async () => {
    expect(await leerCreditoParaReservar(crearEjecutorDoble([[]]).tx, "u1")).toEqual([]);
  });
});

describe("horasCubiertas", () => {
  it("nunca más que lo pedido ni que lo disponible", () => {
    expect(horasCubiertas([lote("a", 1, 6)], 3)).toBe(3);
    expect(horasCubiertas([lote("a", 1, 1.5)], 4)).toBe(1.5);
    expect(horasCubiertas([], 4)).toBe(0);
  });
});

describe("tomarCredito", () => {
  it("reparte en dos lotes, el que vence antes primero, con un UPDATE y un INSERT por lote", async () => {
    const { tx, sentencias } = crearEjecutorDoble([[{ id: "b" }], [], [{ id: "a" }], []]);
    const r = await tomarCredito(tx, { lotes: [lote("a", 20, 4), lote("b", 10, 1)], reservaId: "r1", horas: 2.5, estado: "reservado" });
    expect(r).toEqual({ tomadas: 2.5, faltante: 0 });
    expect(sentencias).toHaveLength(4);
    expect(sentencias[0].sql).toContain('SET "horas_disponibles" = "horas_disponibles" - $1');
    expect(sentencias[0].sql).toContain('"horas_disponibles" >= $3');
    expect(sentencias[0].params).toEqual([1, "b", 1]);
    expect(sentencias[1].params).toEqual(["b", "r1", 1, "reservado"]);
    expect(sentencias[2].params).toEqual([1.5, "a", 1.5]);
    expect(sentencias[3].params).toEqual(["a", "r1", 1.5, "reservado"]);
  });

  it("el estado del uso puede ser consumido", async () => {
    const { tx, sentencias } = crearEjecutorDoble([[{ id: "a" }], []]);
    await tomarCredito(tx, { lotes: [lote("a", 1, 4)], reservaId: "r1", horas: 4, estado: "consumido" });
    expect(sentencias[1].params).toContain("consumido");
  });

  it("si el UPDATE no afecta filas lanza un error de invariante y no inserta el uso", async () => {
    const { tx, sentencias } = crearEjecutorDoble([[]]);
    await expect(tomarCredito(tx, { lotes: [lote("a", 1, 4)], reservaId: "r1", horas: 4, estado: "reservado" })).rejects.toBeInstanceOf(ErrorDeInvariante);
    expect(sentencias).toHaveLength(1);
  });

  it("sin horas no ejecuta nada", async () => {
    const { tx, sentencias } = crearEjecutorDoble();
    expect(await tomarCredito(tx, { lotes: [lote("a", 1, 4)], reservaId: "r1", horas: 0, estado: "reservado" })).toEqual({ tomadas: 0, faltante: 0 });
    expect(sentencias).toHaveLength(0);
  });

  it("si no alcanza y no se permite faltante, lanza antes de escribir", async () => {
    const { tx, sentencias } = crearEjecutorDoble();
    await expect(tomarCredito(tx, { lotes: [lote("a", 1, 1)], reservaId: "r1", horas: 2, estado: "reservado" })).rejects.toBeInstanceOf(ErrorDeInvariante);
    expect(sentencias).toHaveLength(0);
  });

  it("con permitirFaltante toma lo que haya y devuelve cuánto faltó", async () => {
    const { tx } = crearEjecutorDoble([[{ id: "a" }], []]);
    expect(await tomarCredito(tx, { lotes: [lote("a", 1, 1)], reservaId: "r1", horas: 2.5, estado: "consumido", permitirFaltante: true })).toEqual({ tomadas: 1, faltante: 1.5 });
  });
});
