import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Se lee por el nombre y no por el número: otra migración puede generarse antes.
const carpeta = new URL("./migraciones/", import.meta.url);
const archivo = readdirSync(carpeta).find((n) => n.endsWith("_resenas.sql"));
const sql = archivo ? readFileSync(new URL(archivo, carpeta), "utf8") : "";

describe("migración resenas", () => {
  it("existe", () => expect(archivo).toBeDefined());

  it("crea el enum con los tres estados", () => {
    expect(sql).toMatch(/CREATE TYPE "public"\."estado_resena" AS ENUM\('pendiente', 'aprobada', 'rechazada'\)/);
  });

  it("hace única la reserva: una reseña por limpieza", () => {
    expect(sql).toMatch(/CONSTRAINT "resenas_reserva_id_unique" UNIQUE\("reserva_id"\)/);
    expect(sql).toMatch(/"reserva_id" uuid NOT NULL/);
  });

  it("exige estrellas de 1 a 5", () => {
    expect(sql).toMatch(/CONSTRAINT "resenas_estrellas_entre_1_y_5" CHECK \("resenas"\."estrellas" BETWEEN 1 AND 5\)/);
  });

  it("exige autor y fecha de revisión cuando no está pendiente", () => {
    const check = sql.match(/CONSTRAINT "resenas_revision_coherente" CHECK \((.*)\)\n/)?.[1] ?? "";
    expect(check).toContain(`"estado" = 'pendiente' AND "resenas"."revisada_por" IS NULL AND "resenas"."revisada_en" IS NULL`);
    expect(check).toContain(`"estado" <> 'pendiente' AND "resenas"."revisada_por" IS NOT NULL AND "resenas"."revisada_en" IS NOT NULL`);
  });

  it("tiene claves foráneas a reservas y usuarios", () => {
    expect(sql).toMatch(/FOREIGN KEY \("reserva_id"\) REFERENCES "public"\."reservas"\("id"\)/);
    expect(sql).toMatch(/FOREIGN KEY \("revisada_por"\) REFERENCES "public"\."usuarios"\("id"\)/);
  });

  it("tiene los dos índices parciales (aprobadas y pendientes)", () => {
    expect(sql).toMatch(/CREATE INDEX "resenas_aprobadas_idx" .*WHERE "resenas"\."estado" = 'aprobada'/);
    expect(sql).toMatch(/CREATE INDEX "resenas_pendientes_idx" .*WHERE "resenas"\."estado" = 'pendiente'/);
  });

  it("no borra ni altera nada existente", () => {
    expect(sql).not.toMatch(/DROP|ALTER TABLE "(?!resenas)|configuracion|reservas_sin_solape_por_equipo/i);
  });
});
