import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Se lee por el nombre y no por el número: otra migración puede generarse antes.
const carpeta = new URL("./migraciones/", import.meta.url);
const archivo = readdirSync(carpeta).find((n) => n.endsWith("_fotos-servicio.sql"));
const sql = archivo ? readFileSync(new URL(archivo, carpeta), "utf8") : "";

describe("migración fotos-servicio", () => {
  it("existe", () => expect(archivo).toBeDefined());

  it("crea fotos_servicio con ruta única", () => {
    expect(sql).toContain('CREATE TABLE "fotos_servicio"');
    expect(sql).toMatch(/"ruta" text NOT NULL/);
    expect(sql).toMatch(/CONSTRAINT "fotos_servicio_ruta_unique" UNIQUE\("ruta"\)/);
    expect(sql).toMatch(/"ambiente" text NOT NULL/);
    expect(sql).toMatch(/"creada_en" timestamp with time zone DEFAULT now\(\) NOT NULL/);
  });

  it("tiene las dos claves foráneas, a reservas y a usuarios, sin cascada", () => {
    expect(sql).toMatch(/FOREIGN KEY \("reserva_id"\) REFERENCES "public"\."reservas"\("id"\) ON DELETE no action/);
    expect(sql).toMatch(/FOREIGN KEY \("subida_por"\) REFERENCES "public"\."usuarios"\("id"\) ON DELETE no action/);
    expect(sql).not.toMatch(/ON DELETE cascade/i);
  });

  it("crea el índice por reserva y fecha", () => {
    expect(sql).toContain('CREATE INDEX "fotos_servicio_reserva_idx" ON "fotos_servicio" USING btree ("reserva_id","creada_en")');
  });

  it("agrega fotos_maximas_por_reserva = 12 provisional, sin pisar un valor existente", () => {
    expect(sql).toContain(
      `INSERT INTO "configuracion" ("clave", "valor", "provisional") VALUES ('fotos_maximas_por_reserva', '12', true) ON CONFLICT ("clave") DO NOTHING`,
    );
  });

  it("no borra nada ni toca la restricción de exclusión de las reservas", () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toContain("reservas_sin_solape_por_equipo");
  });
});
