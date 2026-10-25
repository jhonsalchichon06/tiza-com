import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./migraciones/0004_membresias-y-pagos.sql", import.meta.url), "utf8");

describe("migración 0004_membresias-y-pagos", () => {
  it("crea los cuatro enums", () => {
    expect(sql).toMatch(/CREATE TYPE "public"\."estado_membresia" AS ENUM\('pendiente', 'activa'\)/);
    expect(sql).toMatch(/CREATE TYPE "public"\."concepto_pago" AS ENUM\('membresia', 'reserva', 'membresia_y_reserva'\)/);
    expect(sql).toMatch(/CREATE TYPE "public"\."metodo_pago" AS ENUM\('yape', 'transferencia', 'credito'\)/);
    expect(sql).toMatch(/CREATE TYPE "public"\."estado_pago" AS ENUM\('pendiente', 'aprobado', 'rechazado'\)/);
  });

  it("crea las tablas membresias y pagos", () => {
    expect(sql).toMatch(/CREATE TABLE "membresias"/);
    expect(sql).toMatch(/CREATE TABLE "pagos"/);
  });

  it("tiene los CHECK de membresías y pagos", () => {
    for (const nombre of [
      "membresias_monto_positivo",
      "membresias_estado_y_fechas",
      "pagos_monto_no_negativo",
      "pagos_membresia_si_concepto",
      "pagos_comprobante_si_no_credito",
      "pagos_credito_sin_monto",
    ]) {
      expect(sql).toContain(`CONSTRAINT "${nombre}" CHECK`);
    }
  });

  it("tiene los tres índices únicos parciales con su WHERE", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX "membresias_una_pendiente_por_cliente" ON "membresias" USING btree \("usuario_id"\) WHERE "membresias"\."estado" = 'pendiente'/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX "reservas_una_pendiente_por_cliente" ON "reservas" USING btree \("usuario_id"\) WHERE "reservas"\."estado" = 'pendiente'/);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "reservas_un_pago_por_reserva_viva" ON "reservas" USING btree \("pago_id"\) WHERE "reservas"\."estado" IN \('pendiente', 'confirmada', 'completada'\)/,
    );
  });

  it("agrega membresia_id y pago_id NOT NULL a reservas, con clave foránea sin cascada", () => {
    expect(sql).toContain('ALTER TABLE "reservas" ADD COLUMN "membresia_id" uuid NOT NULL');
    expect(sql).toContain('ALTER TABLE "reservas" ADD COLUMN "pago_id" uuid NOT NULL');
    expect(sql).toMatch(/"reservas_membresia_id_membresias_id_fk" FOREIGN KEY \("membresia_id"\) REFERENCES "public"\."membresias"\("id"\) ON DELETE no action/);
    expect(sql).toMatch(/"reservas_pago_id_pagos_id_fk" FOREIGN KEY \("pago_id"\) REFERENCES "public"\."pagos"\("id"\) ON DELETE no action/);
    expect(sql).not.toMatch(/ON DELETE cascade/i);
  });

  it("no borra nada ni toca la restricción de exclusión", () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toContain("reservas_sin_solape_por_equipo");
    expect(sql).not.toMatch(/EXCLUDE/);
  });
});
