import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "@/lib/__fixtures__/configuracion";
import { CLAVES_CONFIGURACION, validarParametro } from "@/lib/configuracion";

const sql = readFileSync(new URL("./migraciones/0001_extension_y_datos_iniciales.sql", import.meta.url), "utf8");

// Filas del INSERT de configuracion: ('clave', 'json', provisional)
const filas = [...sql.matchAll(/\('([a-z_]+)', '([^']*)', (true|false)\)/g)].map(([, clave, valor, provisional]) => ({
  clave,
  valor: JSON.parse(valor) as unknown,
  provisional: provisional === "true",
}));

const PROVISIONALES = ["precios_niveles", "multiplicadores_precio", "paquetes_horas", "membresia_precio_mensual"];
// Provisional de renovacion-del-mes-4: la ventana de aviso es propuesta de ese change, no del PRD.
// Provisional de fotos-del-servicio: el 12 de fotos_maximas_por_reserva es un supuesto del diseño, no del PRD.
const PROVISIONALES_POSTERIORES = ["renovacion_aviso_dias", "fotos_maximas_por_reserva"];

describe("migración de datos iniciales", () => {
  it("habilita btree_gist", () => {
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS btree_gist/);
  });

  it("carga las 16 claves de configuración originales (la 17.ª llega en revision-de-pagos)", () => {
    expect(filas).toHaveLength(16);
    expect(filas.map((f) => f.clave).sort()).toEqual([...CLAVES_CONFIGURACION].filter((c) => c !== "reenvio_comprobante_dias" && c !== "cancelacion_minima_horas" && c !== "renovacion_aviso_dias" && c !== "fotos_maximas_por_reserva").sort());
  });

  it("las 16 de 0001 más las claves de las migraciones revision-de-pagos, cancelacion-minima-horas, renovacion-aviso-dias y fotos-servicio son exactamente CLAVES_CONFIGURACION (20)", () => {
    const leer = (sufijo: string) => {
      const nombre = readdirSync(new URL("./migraciones/", import.meta.url)).find((n) => n.endsWith(sufijo))!;
      const sqlNueva = readFileSync(new URL(`./migraciones/${nombre}`, import.meta.url), "utf8");
      return [...sqlNueva.matchAll(/\('([a-z_]+)', '([^']*)', (true|false)\)/g)].map(([, clave, valor, provisional]) => ({
        clave,
        valor: JSON.parse(valor) as unknown,
        provisional: provisional === "true",
      }));
    };
    const nuevas = [...leer("_revision-de-pagos.sql"), ...leer("_cancelacion-minima-horas.sql"), ...leer("_renovacion-aviso-dias.sql"), ...leer("_fotos-servicio.sql")];
    expect(nuevas.map((f) => f.clave)).toEqual(["reenvio_comprobante_dias", "cancelacion_minima_horas", "renovacion_aviso_dias", "fotos_maximas_por_reserva"]);
    for (const n of nuevas) {
      const k = n.clave as (typeof CLAVES_CONFIGURACION)[number];
      expect(validarParametro(k, n.valor)).toEqual(VALORES_DEL_DISENO[k]);
    }
    expect([...filas, ...nuevas].filter((f) => f.provisional).map((f) => f.clave).sort()).toEqual([...PROVISIONALES, ...PROVISIONALES_POSTERIORES].sort());
    expect([...filas, ...nuevas].map((f) => f.clave).sort()).toEqual([...CLAVES_CONFIGURACION].sort());
    expect(CLAVES_CONFIGURACION).toHaveLength(20);
  });

  it.each(filas)("el valor de $clave es válido y coincide con el diseño", ({ clave, valor }) => {
    const k = clave as (typeof CLAVES_CONFIGURACION)[number];
    expect(validarParametro(k, valor)).toEqual(VALORES_DEL_DISENO[k]);
  });

  it("marca como provisionales solo los parámetros pendientes del PRD", () => {
    expect(filas.filter((f) => f.provisional).map((f) => f.clave).sort()).toEqual([...PROVISIONALES].sort());
  });

  it("carga 2 equipos y no pisa datos al volver a aplicarse", () => {
    expect(sql).toMatch(/INSERT INTO "equipos" \("nombre"\) VALUES \('Equipo 1'\), \('Equipo 2'\)/);
    expect(sql.match(/ON CONFLICT \("(clave|nombre)"\) DO NOTHING/g)).toHaveLength(2);
  });
});

describe("migración de autenticación", () => {
  const sqlAuth = readFileSync(new URL("./migraciones/0002_autenticacion.sql", import.meta.url), "utf8");

  it("crea el enum de roles con cliente y admin", () => {
    expect(sqlAuth).toMatch(/CREATE TYPE "public"\."rol_usuario" AS ENUM\('cliente', 'admin'\)/);
  });

  it.each(["usuarios", "sesiones", "cuentas", "verificaciones"])("crea la tabla %s", (tabla) => {
    expect(sqlAuth).toContain(`CREATE TABLE "${tabla}"`);
  });

  it("exige un correo único y rol cliente por defecto", () => {
    expect(sqlAuth).toMatch(/CONSTRAINT "usuarios_email_unique" UNIQUE\("email"\)/);
    expect(sqlAuth).toMatch(/"rol" "rol_usuario" DEFAULT 'cliente' NOT NULL/);
  });
});
