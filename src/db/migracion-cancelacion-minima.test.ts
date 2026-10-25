import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Se lee por el nombre y no por el número: otra migración puede generarse antes.
const carpeta = new URL("./migraciones/", import.meta.url);
const archivo = readdirSync(carpeta).find((n) => n.endsWith("_cancelacion-minima-horas.sql"));
const sql = archivo ? readFileSync(new URL(archivo, carpeta), "utf8") : "";

describe("migración cancelacion-minima-horas", () => {
  it("existe", () => expect(archivo).toBeDefined());

  it("agrega cancelacion_minima_horas = 24 no provisional, sin pisar un valor existente", () => {
    expect(sql).toContain(
      `INSERT INTO "configuracion" ("clave", "valor", "provisional") VALUES ('cancelacion_minima_horas', '24', false) ON CONFLICT ("clave") DO NOTHING`,
    );
  });

  it("es solo de datos: no crea, altera ni borra nada", () => {
    expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP)\b/i);
    expect(sql).not.toContain("reservas_sin_solape_por_equipo");
  });
});
