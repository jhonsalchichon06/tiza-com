import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Se lee por el nombre y no por el número: otra migración puede generarse antes.
const carpeta = new URL("./migraciones/", import.meta.url);
const archivo = readdirSync(carpeta).find((n) => n.endsWith("_reprogramada-por-admin.sql"));
const sql = archivo ? readFileSync(new URL(archivo, carpeta), "utf8") : "";

describe("migración reprogramada-por-admin", () => {
  it("existe", () => expect(archivo).toBeDefined());

  it("solo agrega reprogramada_por y reprogramada_en a reservas, opcionales y sin valor por defecto", () => {
    const sentencias = sql.split("--> statement-breakpoint").map((s) => s.trim().replace(/;$/, ""));
    expect(sentencias).toEqual([
      'ALTER TABLE "reservas" ADD COLUMN "reprogramada_por" text',
      'ALTER TABLE "reservas" ADD COLUMN "reprogramada_en" timestamp with time zone',
    ]);
    expect(sql).not.toMatch(/NOT NULL|DEFAULT|DROP|CREATE|UPDATE|INSERT/i);
  });
});
