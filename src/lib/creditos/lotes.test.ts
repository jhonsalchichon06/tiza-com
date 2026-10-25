import { describe, expect, it } from "vitest";
import { crearEjecutorDoble } from "./__doble__";
import { generarCreditoDeCancelacion } from "./lotes";

describe("generarCreditoDeCancelacion", () => {
  it("pasa los meses como parámetro y no los escribe en el SQL", async () => {
    for (const meses of [2, 3]) {
      const { tx, sentencias } = crearEjecutorDoble([[]]);
      await generarCreditoDeCancelacion(tx, "r1", meses);
      expect(sentencias[0].params).toContain(meses);
      expect(sentencias[0].sql).not.toMatch(/months => \d/);
    }
  });

  it("es una sola sentencia idempotente con toda la condición", async () => {
    const { tx, sentencias } = crearEjecutorDoble([[]]);
    await generarCreditoDeCancelacion(tx, "r1", 3);
    expect(sentencias).toHaveLength(1);
    const s = sentencias[0].sql;
    expect(s).toContain('ON CONFLICT ("reserva_origen_id") DO NOTHING');
    expect(s).toContain(`"cancelada_por" = 'cliente'`);
    expect(s).toContain(`p."estado" = 'aprobado'`);
    expect(s).toContain(`r."estado" = 'cancelada'`);
    expect(s).toContain('"horas_trabajo" - r."horas_gratis_aplicadas" - r."credito_aplicado" > 0');
    expect(s).toContain('r."cancelada_en" + make_interval');
  });

  it("devuelve el lote creado", async () => {
    const vence = new Date("2099-03-01T10:00:00Z");
    const { tx } = crearEjecutorDoble([[{ id: "l1", horas_iniciales: "2.5", vence_en: vence }]]);
    expect(await generarCreditoDeCancelacion(tx, "r1", 3)).toEqual({ id: "l1", horas: 2.5, venceEn: vence });
  });

  it("devuelve null si no insertó nada", async () => {
    const { tx } = crearEjecutorDoble([[]]);
    expect(await generarCreditoDeCancelacion(tx, "r1", 3)).toBeNull();
  });
});
