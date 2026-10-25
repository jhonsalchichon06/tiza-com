import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./migraciones/0003_reservas.sql", import.meta.url), "utf8");

describe("migración 0003_reservas", () => {
  it("crea los tres tipos y la tabla reservas", () => {
    expect(sql).toMatch(/CREATE TYPE "public"\."tipo_servicio" AS ENUM\('estandar', 'profunda', 'mudanza', 'paquete'\)/);
    expect(sql).toMatch(/CREATE TYPE "public"\."estado_reserva" AS ENUM\('pendiente', 'confirmada', 'completada', 'cancelada', 'expirada'\)/);
    expect(sql).toMatch(/CREATE TYPE "public"\."estado_apoyo" AS ENUM\('por_coordinar', 'coordinado'\)/);
    expect(sql).toMatch(/CREATE TABLE "reservas"/);
  });

  it("tiene la restricción de exclusión por equipo con rango semiabierto y solo pendiente y confirmada", () => {
    expect(sql).toMatch(/CONSTRAINT "reservas_sin_solape_por_equipo" EXCLUDE USING gist/);
    expect(sql).toMatch(/"equipo_id" WITH =, tstzrange\("inicio", "fin_bloqueo", '\[\)'\) WITH &&/);
    expect(sql).toMatch(/WHERE \("estado" IN \('pendiente', 'confirmada'\)\)/);
    expect(sql).not.toMatch(/'completada'\)\)\s*;?\s*$/);
  });

  it("tiene los CHECK de coherencia", () => {
    for (const nombre of [
      "reservas_fin_posterior_al_inicio",
      "reservas_bloqueo_no_antes_del_fin",
      "reservas_pendiente_con_vencimiento",
      "reservas_tamano_o_paquete",
      "reservas_apoyo_coherente",
    ]) {
      expect(sql).toContain(`CONSTRAINT "${nombre}" CHECK`);
    }
  });

  it("usa timestamptz para todas las fechas", () => {
    const fechas = ["inicio", "fin", "fin_bloqueo", "expira_en", "creada_en", "actualizada_en"];
    for (const f of fechas) expect(sql).toMatch(new RegExp(`"${f}" timestamp with time zone`));
    expect(sql).not.toMatch(/timestamp without time zone/);
  });

  it("no tiene todavía membresia_id ni pago_id (los agrega el ítem 9)", () => {
    expect(sql).not.toContain("membresia_id");
    expect(sql).not.toContain("pago_id");
  });

  it("no usa Google Maps ni coordenadas (ADR 0013)", () => {
    expect(sql).not.toMatch(/place_id|latitud|longitud/);
  });
});
