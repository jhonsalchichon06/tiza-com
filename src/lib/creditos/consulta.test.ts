import { describe, expect, it } from "vitest";
import { crearEjecutorDoble } from "./__doble__";
import { detalleCreditosAdmin, leerCreditos, listarCreditosAdmin, MAXIMO_DE_CLIENTES, MAXIMO_DE_LOTES, MAXIMO_DE_MOVIMIENTOS } from "./consulta";

const ZONA = "America/Lima";
const VENCE = new Date("2027-02-02T15:00:00Z");

const saldo = (horas: string, proximo: Date | null = VENCE, proximoHoras: string | null = proximo ? "1.5" : null) => [{ saldo: horas, proximo, proximo_horas: proximoHoras }];
const lote = (extra: Record<string, unknown> = {}) => ({
  id: "l1",
  horas_iniciales: "4.0",
  horas_disponibles: "2.5",
  creado_en: new Date("2026-11-02T15:00:00Z"),
  vence_en: VENCE,
  vigente: true,
  reserva_origen_id: "r0",
  origen_inicio: new Date("2026-11-05T15:00:00Z"),
  origen_cancelada_en: new Date("2026-11-02T15:00:00Z"),
  ...extra,
});
const mov = (tipo: string, extra: Record<string, unknown> = {}) => ({ tipo, horas: "1.5", fecha: new Date("2026-11-10T15:00:00Z"), reserva_id: "r1", reserva_inicio: new Date("2026-11-12T15:00:00Z"), ...extra });

describe("leerCreditos", () => {
  it("devuelve saldo, próximo vencimiento, lotes y movimientos con fechas en hora de Lima", async () => {
    const { tx } = crearEjecutorDoble([saldo("2.5"), [lote()], [mov("generado"), mov("usado")]]);
    const r = await leerCreditos(tx, "u1", ZONA);
    expect(r.saldo_horas).toBe(2.5);
    expect(r.proximo_vencimiento).toEqual({ horas: 1.5, vence_en: "2027-02-02T10:00:00-05:00" });
    expect(r.lotes).toEqual([
      {
        id: "l1",
        horas_iniciales: 4,
        horas_disponibles: 2.5,
        creado_en: "2026-11-02T10:00:00-05:00",
        vence_en: "2027-02-02T10:00:00-05:00",
        vigente: true,
        origen: { reserva_id: "r0", inicio: "2026-11-05T10:00:00-05:00", cancelada_en: "2026-11-02T10:00:00-05:00" },
      },
    ]);
    expect(r.movimientos.map((m) => m.tipo)).toEqual(["generado", "usado"]);
    expect(r.movimientos[0]).toEqual({ tipo: "generado", horas: 1.5, fecha: "2026-11-10T10:00:00-05:00", reserva: { id: "r1", inicio: "2026-11-12T10:00:00-05:00" } });
  });

  it("un lote vencido sale con vigente falso y no cuenta en el saldo", async () => {
    const { tx } = crearEjecutorDoble([saldo("0", null), [lote({ vigente: false, vence_en: new Date("2026-01-01T00:00:00Z") })], []]);
    const r = await leerCreditos(tx, "u1", ZONA);
    expect(r.lotes[0].vigente).toBe(false);
    expect(r.saldo_horas).toBe(0);
    expect(r.proximo_vencimiento).toBeNull();
  });

  it("sin crédito devuelve todo vacío", async () => {
    const { tx } = crearEjecutorDoble([saldo("0", null), [], []]);
    expect(await leerCreditos(tx, "u1", ZONA)).toEqual({ saldo_horas: 0, proximo_vencimiento: null, lotes: [], movimientos: [] });
  });

  it("todas las consultas llevan el usuario_id y los topes son 20 y 50", async () => {
    const { tx, sentencias } = crearEjecutorDoble([saldo("0", null), [], []]);
    await leerCreditos(tx, "u1", ZONA);
    expect(sentencias).toHaveLength(3);
    for (const s of sentencias) expect(s.params).toContain("u1");
    expect(sentencias[1].params).toContain(MAXIMO_DE_LOTES);
    expect(sentencias[2].params).toContain(MAXIMO_DE_MOVIMIENTOS);
    expect(sentencias[2].params.filter((p) => p === "u1")).toHaveLength(3);
    expect(MAXIMO_DE_LOTES).toBe(20);
    expect(MAXIMO_DE_MOVIMIENTOS).toBe(50);
  });

  it("calcula vigente con el reloj de la base, ordena los movimientos por fecha y no escribe", async () => {
    const { tx, sentencias } = crearEjecutorDoble([saldo("0", null), [], []]);
    await leerCreditos(tx, "u1", ZONA);
    expect(sentencias[1].sql).toContain('"vence_en" > now()) AS "vigente"');
    expect(sentencias[2].sql).toContain('ORDER BY "fecha" DESC');
    expect(sentencias.every((s) => !/^(INSERT|UPDATE|DELETE)/i.test(s.sql))).toBe(true);
  });
});

describe("listarCreditosAdmin", () => {
  it("lista clientes con su saldo y próximo vencimiento, máximo 100", async () => {
    const { tx, sentencias } = crearEjecutorDoble([[{ usuario_id: "u1", nombre: "Ana", correo: "a@tiza.test", saldo: "3.5", proximo: VENCE, lotes: "2" }]]);
    const r = await listarCreditosAdmin(tx, ZONA);
    expect(r).toEqual([{ usuario_id: "u1", nombre: "Ana", correo: "a@tiza.test", saldo_horas: 3.5, proximo_vencimiento: "2027-02-02T10:00:00-05:00", lotes: 2 }]);
    expect(sentencias[0].params).toContain(MAXIMO_DE_CLIENTES);
    expect(sentencias[0].sql).toContain('ORDER BY "proximo" ASC NULLS LAST');
  });

  it("sin lotes devuelve una lista vacía", async () => {
    expect(await listarCreditosAdmin(crearEjecutorDoble([[]]).tx, ZONA)).toEqual([]);
  });
});

describe("detalleCreditosAdmin", () => {
  it("devuelve al cliente y la misma forma que leerCreditos", async () => {
    const { tx, sentencias } = crearEjecutorDoble([[{ id: "u1", nombre: "Ana", correo: "a@tiza.test" }], saldo("2.5"), [lote()], []]);
    const r = await detalleCreditosAdmin(tx, "u1", ZONA);
    expect(r.cliente).toEqual({ usuario_id: "u1", nombre: "Ana", correo: "a@tiza.test" });
    expect(r.saldo_horas).toBe(2.5);
    expect(r.lotes).toHaveLength(1);
    expect(sentencias[0].params).toEqual(["u1"]);
  });

  it("404 si el cliente no existe y no lee créditos", async () => {
    const { tx, sentencias } = crearEjecutorDoble([[]]);
    await expect(detalleCreditosAdmin(tx, "nadie", ZONA)).rejects.toMatchObject({ status: 404 });
    expect(sentencias).toHaveLength(1);
  });
});
