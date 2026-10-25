import { describe, expect, it } from "vitest";
import { horasPagadasEnDinero, repartirCredito } from "./reparto";

const lote = (id: string, dias: number, horasDisponibles: number) => ({ id, venceEn: new Date(Date.UTC(2026, 0, 1 + dias)), horasDisponibles });

describe("repartirCredito", () => {
  it("toma primero del lote que vence antes", () => {
    const { reparto, sobrante } = repartirCredito([lote("b", 40, 3), lote("a", 10, 2)], 4);
    expect(reparto).toEqual([
      { creditoId: "a", horas: 2 },
      { creditoId: "b", horas: 2 },
    ]);
    expect(sobrante).toBe(0);
  });

  it("desempata por id cuando vencen a la vez", () => {
    const { reparto } = repartirCredito([lote("z", 10, 2), lote("a", 10, 2)], 2);
    expect(reparto).toEqual([{ creditoId: "a", horas: 2 }]);
  });

  it("con 6 horas de crédito y un servicio de 3 usa solo 3", () => {
    const { reparto, sobrante } = repartirCredito([lote("a", 10, 6)], 3);
    expect(reparto).toEqual([{ creditoId: "a", horas: 3 }]);
    expect(sobrante).toBe(0);
  });

  it("reparte 1,5 horas en dos lotes con medias horas exactas", () => {
    const { reparto, sobrante } = repartirCredito([lote("a", 1, 0.5), lote("b", 2, 2)], 1.5);
    expect(reparto).toEqual([
      { creditoId: "a", horas: 0.5 },
      { creditoId: "b", horas: 1 },
    ]);
    expect(sobrante).toBe(0);
  });

  it("devuelve el sobrante cuando no alcanza y nunca toma más de lo disponible", () => {
    const { reparto, sobrante } = repartirCredito([lote("a", 1, 1), lote("b", 2, 0.5)], 4);
    expect(reparto).toEqual([
      { creditoId: "a", horas: 1 },
      { creditoId: "b", horas: 0.5 },
    ]);
    expect(sobrante).toBe(2.5);
  });

  it("sin lotes, con lotes vacíos o con 0 horas no reparte nada", () => {
    expect(repartirCredito([], 2)).toEqual({ reparto: [], sobrante: 2 });
    expect(repartirCredito([lote("a", 1, 0)], 2)).toEqual({ reparto: [], sobrante: 2 });
    expect(repartirCredito([lote("a", 1, 3)], 0)).toEqual({ reparto: [], sobrante: 0 });
  });

  it("no modifica la lista recibida", () => {
    const lotes = [lote("b", 40, 3), lote("a", 10, 2)];
    repartirCredito(lotes, 1);
    expect(lotes.map((l) => l.id)).toEqual(["b", "a"]);
  });
});

describe("horasPagadasEnDinero", () => {
  it("5 h con 3 gratis → 2", () => expect(horasPagadasEnDinero({ horasTrabajo: 5, horasGratis: 3, creditoAplicado: 0 })).toBe(2));
  it("3 h con 3 gratis → 0", () => expect(horasPagadasEnDinero({ horasTrabajo: 3, horasGratis: 3, creditoAplicado: 0 })).toBe(0));
  it("4 h con 1,5 de crédito → 2,5", () => expect(horasPagadasEnDinero({ horasTrabajo: 4, horasGratis: 0, creditoAplicado: 1.5 })).toBe(2.5));
  it("nunca baja de 0", () => expect(horasPagadasEnDinero({ horasTrabajo: 3, horasGratis: 3, creditoAplicado: 2 })).toBe(0));
});
