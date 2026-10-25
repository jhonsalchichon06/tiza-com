import { describe, expect, it } from "vitest";
import { crearEjecutorDoble } from "../creditos/__doble__";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { calcularServicio } from "../precios";
import { creditoParaReserva } from "./credito";

describe("creditoParaReserva (cotización: saldo vigente sin bloquear)", () => {
  it("lee el saldo del cliente de la base, sin FOR UPDATE", async () => {
    const { tx, sentencias } = crearEjecutorDoble([[{ saldo: "3.5", proximo: null }]]);
    expect(await creditoParaReserva(tx, "u1", 4)).toBe(3.5);
    expect(sentencias).toHaveLength(1);
    expect(sentencias[0].params).toEqual(["u1"]);
    expect(sentencias[0].sql).not.toContain("FOR UPDATE");
  });

  it("sin lotes da 0", async () => {
    expect(await creditoParaReserva(crearEjecutorDoble([[]]).tx, "u1", 4)).toBe(0);
  });

  const servicio = { tipo: "estandar", dormitorios: 2, banos: 1 } as const;

  it("el saldo se descuenta de las horas a cobrar", () => {
    const sin = calcularServicio(VALORES_DEL_DISENO, servicio);
    const con = calcularServicio(VALORES_DEL_DISENO, { ...servicio, creditoHoras: 2 });
    expect(con).toMatchObject({ credito_aplicado: 2, horas_cobrar: 2 });
    expect(con.monto).toBeLessThan(sin.monto);
  });

  it("un saldo mayor que las horas a cobrar queda acotado por calcularServicio", () => {
    const c = calcularServicio(VALORES_DEL_DISENO, { ...servicio, creditoHoras: 10 });
    expect(c).toMatchObject({ credito_aplicado: 4, horas_cobrar: 0, monto: 0 });
  });
});
