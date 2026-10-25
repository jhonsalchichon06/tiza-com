import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { ClaveHogar } from "../direccion";
import { decidirLimpiezaGratis } from "./gratis";

// La limpieza gratis conservada (PRD, alcance 3 y caso borde 11): se prueba con la regla REAL de `decidirLimpiezaGratis`
// (no se cambia `gratis.ts`) y un doble de `tx.select().from().where().limit()` que filtra por los parámetros del WHERE.

type EstadoReserva = "pendiente" | "confirmada" | "completada" | "cancelada" | "expirada";
type Fila = { usuarioId: string; estado: EstadoReserva; primeraGratis: boolean; hogar: ClaveHogar };

const ESTADOS: string[] = ["pendiente", "confirmada", "completada", "cancelada", "expirada"];
const HOGAR: ClaveHogar = { distrito: "Miraflores", direccionNormalizada: "avenida larco 123", departamentoNormalizado: "dpto 302" };
const OTRO_HOGAR: ClaveHogar = { distrito: "San Borja", direccionNormalizada: "avenida aviacion 2530", departamentoNormalizado: "" };

function txCon(filas: Fila[]) {
  const dialecto = new PgDialect();
  const tx = {
    select: () => ({
      from: () => ({
        where: (donde: Parameters<PgDialect["sqlToQuery"]>[0]) => {
          const consulta = dialecto.sqlToQuery(donde);
          return {
            limit: async () => {
              const estados = consulta.params.filter((p): p is string => typeof p === "string" && ESTADOS.includes(p));
              const porHogar = consulta.sql.includes('"primera_gratis"');
              return filas
                .filter((f) => estados.includes(f.estado))
                .filter((f) =>
                  porHogar
                    ? f.primeraGratis && f.hogar.distrito === consulta.params[1] && f.hogar.direccionNormalizada === consulta.params[2] && f.hogar.departamentoNormalizado === consulta.params[3]
                    : f.usuarioId === consulta.params[0],
                )
                .map((_, i) => ({ id: String(i) }));
            },
          };
        },
      }),
    }),
  };
  return tx as unknown as Parameters<typeof decidirLimpiezaGratis>[0];
}

const primera = (estado: EstadoReserva): Fila => ({ usuarioId: "u1", estado, primeraGratis: true, hogar: HOGAR });

describe("limpieza gratis conservada tras cancelar la primera", () => {
  it("con la primera cancelada y ninguna otra viva o realizada, el hogar vuelve a recibirla", async () => {
    expect(await decidirLimpiezaGratis(txCon([primera("cancelada")]), "u1", HOGAR)).toBe(true);
  });

  it("la primera expirada también cuenta como no usada", async () => {
    expect(await decidirLimpiezaGratis(txCon([primera("expirada")]), "u1", HOGAR)).toBe(true);
  });

  it("con una completada ya no hay horas gratis", async () => {
    const filas = [primera("cancelada"), { ...primera("completada"), primeraGratis: false }];
    expect(await decidirLimpiezaGratis(txCon(filas), "u1", HOGAR)).toBe(false);
  });

  it("con otra confirmada o pendiente tampoco", async () => {
    for (const estado of ["confirmada", "pendiente"] as const) {
      const filas = [primera("cancelada"), { ...primera(estado), primeraGratis: false }];
      expect(await decidirLimpiezaGratis(txCon(filas), "u1", HOGAR)).toBe(false);
    }
  });

  it("con el hogar tomado por otra cuenta no hay horas gratis", async () => {
    const filas = [primera("cancelada"), { usuarioId: "u2", estado: "confirmada" as const, primeraGratis: true, hogar: HOGAR }];
    expect(await decidirLimpiezaGratis(txCon(filas), "u1", HOGAR)).toBe(false);
  });

  it("con otra dirección decide por la dirección nueva", async () => {
    const tomado = { usuarioId: "u2", estado: "confirmada" as const, primeraGratis: true, hogar: HOGAR };
    // La dirección nueva no está tomada: sí. La anterior sí lo está: no.
    expect(await decidirLimpiezaGratis(txCon([primera("cancelada"), tomado]), "u1", OTRO_HOGAR)).toBe(true);
    expect(await decidirLimpiezaGratis(txCon([primera("cancelada"), tomado]), "u1", HOGAR)).toBe(false);
  });
});
