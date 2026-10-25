import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./migraciones/0005_una-gratis-por-cliente-y-hogar.sql", import.meta.url), "utf8");
const ESTADOS = String.raw`"reservas"\."primera_gratis" AND "reservas"\."estado" IN \('pendiente', 'confirmada', 'completada'\)`;

describe("migración 0005_una-gratis-por-cliente-y-hogar", () => {
  it("crea el índice único parcial por cliente", () => {
    expect(sql).toMatch(new RegExp(`CREATE UNIQUE INDEX "reservas_primera_gratis_por_cliente" ON "reservas" USING btree \\("usuario_id"\\) WHERE ${ESTADOS}`));
  });

  it("crea el índice único parcial por hogar con distrito, dirección y departamento normalizados", () => {
    expect(sql).toMatch(
      new RegExp(
        `CREATE UNIQUE INDEX "reservas_primera_gratis_por_hogar" ON "reservas" USING btree \\("distrito","direccion_normalizada","departamento_normalizado"\\) WHERE ${ESTADOS}`,
      ),
    );
  });

  it("solo crea esos dos índices: no borra, no altera tablas y no toca la exclusión", () => {
    expect(sql.match(/CREATE UNIQUE INDEX/g)).toHaveLength(2);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/ALTER TABLE/i);
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toContain("reservas_sin_solape_por_equipo");
  });
});
