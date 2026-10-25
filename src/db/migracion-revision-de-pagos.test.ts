import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Se lee por el nombre (`revision-de-pagos`) y no por el número: otra migración puede generarse antes.
const carpeta = new URL("./migraciones/", import.meta.url);
const archivo = readdirSync(carpeta).find((n) => n.endsWith("_revision-de-pagos.sql"));
const sql = archivo ? readFileSync(new URL(archivo, carpeta), "utf8") : "";

describe("migración revision-de-pagos", () => {
  it("existe", () => expect(archivo).toBeDefined());

  it("agrega las columnas de pagos y de reservas", () => {
    expect(sql).toContain('ALTER TABLE "pagos" ADD COLUMN "motivo_rechazo" text');
    expect(sql).toContain('ALTER TABLE "pagos" ADD COLUMN "reemplaza_a" uuid');
    expect(sql).toContain('ALTER TABLE "reservas" ADD COLUMN "cancelada_por" "quien_cancela"');
    expect(sql).toMatch(/"pagos_reemplaza_a_pagos_id_fk" FOREIGN KEY \("reemplaza_a"\) REFERENCES "public"\."pagos"\("id"\) ON DELETE no action/);
  });

  it("crea el enum quien_cancela y agrega caducada al de membresías", () => {
    expect(sql).toContain(`CREATE TYPE "public"."quien_cancela" AS ENUM('cliente', 'admin')`);
    expect(sql).toContain(`ALTER TYPE "public"."estado_membresia" ADD VALUE 'caducada'`);
  });

  it("crea el índice único parcial de reemplazos y el índice de pendientes", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX "pagos_un_reemplazo_por_pago" ON "pagos" USING btree \("reemplaza_a"\) WHERE "pagos"\."reemplaza_a" IS NOT NULL/);
    expect(sql).toMatch(/CREATE INDEX "pagos_pendientes_idx" ON "pagos" USING btree \("creado_en"\) WHERE "pagos"\."estado" = 'pendiente'/);
  });

  it("tiene los CHECK de pagos y de reservas", () => {
    expect(sql).toContain('ADD CONSTRAINT "pagos_motivo_rechazo_corto" CHECK (char_length("pagos"."motivo_rechazo") <= 200)');
    expect(sql).toMatch(/ADD CONSTRAINT "pagos_revision_coherente" CHECK \(\("pagos"\."estado" = 'pendiente' AND "pagos"\."revisado_por" IS NULL AND "pagos"\."revisado_en" IS NULL\) OR "pagos"\."estado" = 'aprobado' OR \("pagos"\."estado" = 'rechazado' AND "pagos"\."revisado_por" IS NOT NULL AND "pagos"\."revisado_en" IS NOT NULL\)\)/);
    expect(sql).toContain('ADD CONSTRAINT "reservas_cancelada_por_coherente" CHECK ("reservas"."cancelada_por" IS NULL OR "reservas"."estado" = \'cancelada\')');
  });

  it("reescribe el CHECK de membresías sin nombrar caducada", () => {
    const nuevo = sql.match(/ADD CONSTRAINT "membresias_estado_y_fechas" CHECK \(.*?\);/s)?.[0] ?? "";
    expect(nuevo).toContain(`"membresias"."estado" <> 'activa' AND "membresias"."inicio" IS NULL AND "membresias"."fin" IS NULL`);
    expect(nuevo).not.toContain("caducada");
  });

  it("ningún CHECK ni índice nombra caducada (el valor se agrega en la misma transacción)", () => {
    const usos = sql.split("--> statement-breakpoint").filter((s) => s.includes("caducada"));
    expect(usos).toHaveLength(1);
    expect(usos[0]).toContain("ADD VALUE 'caducada'");
  });

  it("agrega reenvio_comprobante_dias = 7 no provisional, sin pisar un valor existente", () => {
    expect(sql).toContain(`INSERT INTO "configuracion" ("clave", "valor", "provisional") VALUES ('reenvio_comprobante_dias', '7', false) ON CONFLICT ("clave") DO NOTHING`);
  });

  it("el único DROP es el del CHECK de membresías y no toca el EXCLUDE", () => {
    const drops = sql.match(/\bDROP\b[^;]*;/gi) ?? [];
    expect(drops).toEqual(['DROP CONSTRAINT "membresias_estado_y_fechas";']);
    expect(sql).not.toContain("reservas_sin_solape_por_equipo");
  });
});
