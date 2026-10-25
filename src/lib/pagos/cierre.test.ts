import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { cerrarMembresiasSinReenvio } from "./cierre";

const dialecto = new PgDialect();
const render = (donde: unknown) => dialecto.sqlToQuery(donde as Parameters<PgDialect["sqlToQuery"]>[0]);

// Doble de la transacción: registra la sentencia de bloqueo y la de cierre.
function crearTx(candidatas: string[], cerradas: string[] = candidatas, falla?: Error) {
  const registro = { select: 0, bloqueo: 0, update: 0, whereUpdate: null as null | ReturnType<typeof render> };
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async (modo: string) => {
            registro.select++;
            if (modo === "update") registro.bloqueo++;
            if (falla) throw falla;
            return candidatas.map((id) => ({ id }));
          },
        }),
      }),
    }),
    update: () => ({
      set: (valores: { estado: string }) => ({
        where: (donde: unknown) => ({
          returning: async () => {
            registro.update++;
            registro.whereUpdate = render(donde);
            expect(valores).toEqual({ estado: "caducada" });
            return cerradas.map((id) => ({ id }));
          },
        }),
      }),
    }),
  };
  return { tx: tx as unknown as Parameters<typeof cerrarMembresiasSinReenvio>[0], registro };
}

describe("cerrarMembresiasSinReenvio", () => {
  it("sin candidatas devuelve [] y no ejecuta el UPDATE", async () => {
    const { tx, registro } = crearTx([]);
    expect(await cerrarMembresiasSinReenvio(tx, 7)).toEqual([]);
    expect(registro.update).toBe(0);
  });

  it("la primera sentencia lleva FOR UPDATE", async () => {
    const { tx, registro } = crearTx(["m1"]);
    await cerrarMembresiasSinReenvio(tx, 7);
    expect(registro.bloqueo).toBe(1);
  });

  it("devuelve los ids cerrados por el UPDATE, no las candidatas", async () => {
    const { tx } = crearTx(["m1", "m2"], ["m2"]);
    expect(await cerrarMembresiasSinReenvio(tx, 7)).toEqual(["m2"]);
  });

  it.each([2, 7, 30])("el plazo de %i días llega al UPDATE como parámetro", async (dias) => {
    const { tx, registro } = crearTx(["m1"]);
    await cerrarMembresiasSinReenvio(tx, dias);
    expect(registro.whereUpdate!.params).toContain(dias);
    expect(registro.whereUpdate!.sql).toContain("make_interval(days =>");
    expect(registro.whereUpdate!.sql).toContain("now()");
  });

  it("el UPDATE excluye las membresías con un pago pendiente y exige que todos los rechazos superen el plazo", async () => {
    const { tx, registro } = crearTx(["m1"]);
    await cerrarMembresiasSinReenvio(tx, 7);
    const q = registro.whereUpdate!.sql;
    expect(q).toMatch(/NOT EXISTS \(SELECT 1 FROM pagos p WHERE p\.membresia_id = "membresias"\."id" AND p\.estado = 'pendiente'\)/);
    expect(q).toMatch(/NOT EXISTS \(SELECT 1 FROM pagos p WHERE p\.membresia_id = "membresias"\."id" AND p\.estado = 'rechazado' AND p\.revisado_en \+ make_interval/);
    expect(q).toContain('"membresias"."estado" = $');
  });

  it("un error de la transacción se propaga", async () => {
    const { tx } = crearTx(["m1"], ["m1"], new Error("boom"));
    await expect(cerrarMembresiasSinReenvio(tx, 7)).rejects.toThrow("boom");
  });
});
