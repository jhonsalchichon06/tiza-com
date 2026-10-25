import { describe, expect, it } from "vitest";
import { crearEjecutorDoble } from "./__doble__";
import { leerSaldoVigente, proximoVencimiento } from "./saldo";

describe("saldo de crédito", () => {
  it("filtra por usuario, usa el reloj de la base y toma el lote que vence primero (por vence_en y id)", async () => {
    const { tx, sentencias } = crearEjecutorDoble([[{ saldo: "4.5", proximo: null, proximo_horas: null }]]);
    expect(await leerSaldoVigente(tx, "u1")).toBe(4.5);
    expect(sentencias[0].params).toEqual(["u1"]);
    expect(sentencias[0].sql).toContain('"usuario_id" = $1');
    expect(sentencias[0].sql).toContain('"vence_en" > now()');
    expect(sentencias[0].sql).not.toContain("FOR UPDATE");
    expect(sentencias[0].sql).toContain('ORDER BY "vence_en", "id"');
  });

  it("es cero cuando no hay lotes", async () => {
    expect(await leerSaldoVigente(crearEjecutorDoble([[{ saldo: "0", proximo: null, proximo_horas: null }]]).tx, "u1")).toBe(0);
    expect(await leerSaldoVigente(crearEjecutorDoble([[]]).tx, "u1")).toBe(0);
  });

  it("devuelve el próximo vencimiento o null", async () => {
    const f = new Date("2099-01-01T00:00:00Z");
    expect(await proximoVencimiento(crearEjecutorDoble([[{ saldo: "3", proximo: f, proximo_horas: "2.5" }]]).tx, "u1")).toEqual({ horas: 2.5, venceEn: f });
    expect(await proximoVencimiento(crearEjecutorDoble([[{ saldo: "0", proximo: null, proximo_horas: null }]]).tx, "u1")).toBeNull();
  });
});
