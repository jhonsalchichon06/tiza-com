import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Se lee por el nombre (`credito-en-horas`) y no por el número: otra migración puede generarse antes.
const carpeta = new URL("./migraciones/", import.meta.url);
const archivo = readdirSync(carpeta).find((n) => n.endsWith("_credito-en-horas.sql"));
const sql = archivo ? readFileSync(new URL(archivo, carpeta), "utf8") : "";
const sinComentarios = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--") || l.includes("--> statement-breakpoint"))
  .join("\n");

describe("migración credito-en-horas", () => {
  it("existe", () => expect(archivo).toBeDefined());

  it("crea el enum de estados de uso y las dos tablas", () => {
    expect(sql).toContain(`CREATE TYPE "public"."estado_uso_credito" AS ENUM('reservado', 'consumido', 'devuelto')`);
    expect(sql).toContain('CREATE TABLE "creditos_horas"');
    expect(sql).toContain('CREATE TABLE "usos_credito"');
    expect(sql).toContain('"horas_disponibles" numeric(4, 1) NOT NULL');
  });

  it("tiene los CHECK de horas positivas, en rango y en múltiplos de 0,5", () => {
    expect(sql).toContain('CONSTRAINT "creditos_horas_iniciales_positivas" CHECK ("creditos_horas"."horas_iniciales" > 0)');
    expect(sql).toContain('"creditos_horas"."horas_disponibles" >= 0 AND "creditos_horas"."horas_disponibles" <= "creditos_horas"."horas_iniciales"');
    expect(sql).toContain('mod("creditos_horas"."horas_iniciales" * 2, 1) = 0');
    expect(sql).toContain('CONSTRAINT "usos_credito_horas_positivas" CHECK ("usos_credito"."horas" > 0 AND mod("usos_credito"."horas" * 2, 1) = 0)');
  });

  it("tiene los índices únicos de un lote por cancelación y de un uso por lote y reserva", () => {
    expect(sql).toContain('CREATE UNIQUE INDEX "creditos_un_lote_por_cancelacion" ON "creditos_horas" USING btree ("reserva_origen_id")');
    expect(sql).toContain('CREATE UNIQUE INDEX "usos_credito_un_uso_por_lote_y_reserva" ON "usos_credito" USING btree ("credito_id","reserva_destino_id")');
    expect(sql).toContain('CREATE INDEX "creditos_horas_usuario_vence_idx" ON "creditos_horas" USING btree ("usuario_id","vence_en")');
    expect(sql).toContain('CREATE INDEX "usos_credito_reserva_destino_idx" ON "usos_credito" USING btree ("reserva_destino_id")');
  });

  it("agrega reservas.cancelada_en con su CHECK", () => {
    expect(sql).toContain('ALTER TABLE "reservas" ADD COLUMN "cancelada_en" timestamp with time zone');
    expect(sql).toContain(`ADD CONSTRAINT "reservas_cancelada_en_coherente" CHECK ("reservas"."cancelada_en" IS NULL OR "reservas"."estado" = 'cancelada')`);
  });

  it("rellena cancelada_en con actualizada_en en las canceladas", () => {
    expect(sql).toContain(`UPDATE "reservas" SET "cancelada_en" = "actualizada_en" WHERE "estado" = 'cancelada' AND "cancelada_en" IS NULL;`);
  });

  it("recupera los créditos con ON CONFLICT DO NOTHING y lee los meses de configuracion", () => {
    expect(sql).toContain("-- recuperar-creditos");
    const sentencia = sql.slice(sql.indexOf("-- recuperar-creditos")).split("\n").filter((l) => !l.startsWith("--")).join("\n");
    expect(sentencia).toContain('INSERT INTO "creditos_horas"');
    expect(sentencia).toContain(`"cancelada_por" = 'cliente'`);
    expect(sentencia).toContain(`p."estado" = 'aprobado'`);
    expect(sentencia).toContain('ON CONFLICT ("reserva_origen_id") DO NOTHING');
    expect(sentencia).toContain(`"clave" = 'credito_vence_meses'`);
    expect(sentencia).toContain(`"valor" #>> '{}'`);
    expect(sentencia).not.toMatch(/months => \d/);
  });

  it("solo crea y agrega: sin DROP, sin tocar el EXCLUDE ni insertar en configuracion", () => {
    expect(sinComentarios).not.toMatch(/\bDROP\b/i);
    expect(sinComentarios).not.toContain("reservas_sin_solape_por_equipo");
    expect(sinComentarios).not.toMatch(/INSERT INTO "configuracion"/);
    expect(sinComentarios).not.toMatch(/UPDATE "configuracion"/);
  });
});
