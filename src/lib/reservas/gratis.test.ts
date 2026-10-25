import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { ClaveHogar } from "../direccion";
import { decidirLimpiezaGratis, decidirPorCliente, decidirPorHogar } from "./gratis";

type EstadoReserva = "pendiente" | "confirmada" | "completada" | "cancelada" | "expirada";
type Fila = { usuarioId: string; estado: EstadoReserva; primeraGratis: boolean; hogar: ClaveHogar };

const ESTADOS: string[] = ["pendiente", "confirmada", "completada", "cancelada", "expirada"];
const HOGAR: ClaveHogar = { distrito: "Miraflores", direccionNormalizada: "avenida larco 123", departamentoNormalizado: "dpto 302" };
const OTRO_HOGAR: ClaveHogar = { distrito: "Miraflores", direccionNormalizada: "avenida larco 123", departamentoNormalizado: "dpto 401" };

// Doble de `tx.select().from().where().limit()`: lee los parámetros del WHERE que armó la función y filtra las filas
// dadas. Los parámetros del cliente son [usuarioId, estados...] y los del hogar [true, distrito, dirección, departamento, estados...].
function txCon(filas: Fila[]) {
  const dialecto = new PgDialect();
  const consultas: { sql: string; params: unknown[] }[] = [];
  const tx = {
    select: () => ({
      from: () => ({
        where: (donde: Parameters<PgDialect["sqlToQuery"]>[0]) => {
          const consulta = dialecto.sqlToQuery(donde);
          consultas.push(consulta);
          return {
            limit: async () => {
              const estados = consulta.params.filter((p): p is string => typeof p === "string" && ESTADOS.includes(p));
              const porHogar = consulta.sql.includes('"primera_gratis"');
              return filas
                .filter((f) => estados.includes(f.estado))
                .filter((f) =>
                  porHogar
                    ? f.primeraGratis &&
                      f.hogar.distrito === consulta.params[1] &&
                      f.hogar.direccionNormalizada === consulta.params[2] &&
                      f.hogar.departamentoNormalizado === consulta.params[3]
                    : f.usuarioId === consulta.params[0],
                )
                .map((_, i) => ({ id: String(i) }));
            },
          };
        },
      }),
    }),
  };
  return { tx: tx as unknown as Parameters<typeof decidirLimpiezaGratis>[0], consultas };
}

const fila = (estado: EstadoReserva, extra: Partial<Fila> = {}): Fila => ({ usuarioId: "otro", estado, primeraGratis: true, hogar: HOGAR, ...extra });

describe("decidirLimpiezaGratis", () => {
  it("cliente nuevo y hogar nuevo reciben las horas gratis", async () => {
    expect(await decidirLimpiezaGratis(txCon([]).tx, "u1", HOGAR)).toBe(true);
  });

  it.each(["pendiente", "confirmada", "completada"] as const)("una reserva %s del cliente (en otro hogar) impide la gratis", async (estado) => {
    const filas = [fila(estado, { usuarioId: "u1", primeraGratis: false, hogar: OTRO_HOGAR })];
    expect(await decidirLimpiezaGratis(txCon(filas).tx, "u1", HOGAR)).toBe(false);
  });

  it.each(["pendiente", "confirmada", "completada"] as const)("una gratis %s de otra cuenta en el hogar impide la gratis", async (estado) => {
    expect(await decidirLimpiezaGratis(txCon([fila(estado)]).tx, "u1", HOGAR)).toBe(false);
  });

  it("solo canceladas o expiradas del hogar o del cliente: sí la recibe", async () => {
    const filas = [fila("cancelada"), fila("expirada"), fila("cancelada", { usuarioId: "u1" }), fila("expirada", { usuarioId: "u1" })];
    expect(await decidirLimpiezaGratis(txCon(filas).tx, "u1", HOGAR)).toBe(true);
  });

  it("un hogar con solo reservas pagadas sí la recibe", async () => {
    const filas = [fila("confirmada", { primeraGratis: false }), fila("completada", { primeraGratis: false })];
    expect(await decidirLimpiezaGratis(txCon(filas).tx, "u1", HOGAR)).toBe(true);
  });

  it("otro departamento del mismo edificio no cuenta", async () => {
    expect(await decidirLimpiezaGratis(txCon([fila("confirmada", { hogar: OTRO_HOGAR })]).tx, "u1", HOGAR)).toBe(true);
  });

  it("la consulta del cliente filtra por el cliente y por la condición compartida", async () => {
    const { tx, consultas } = txCon([]);
    await decidirPorCliente(tx, "cliente-7");
    expect(consultas[0].params[0]).toBe("cliente-7");
    expect(consultas[0].params).toEqual(expect.arrayContaining(["confirmada", "completada", "pendiente"]));
    expect(consultas[0].sql).toContain("expira_en");
  });

  it("la consulta del hogar filtra por distrito, dirección y departamento normalizados, y no por las referencias", async () => {
    const { tx, consultas } = txCon([]);
    await decidirPorHogar(tx, HOGAR);
    const { sql, params } = consultas[0];
    expect(params.slice(0, 4)).toEqual([true, "Miraflores", "avenida larco 123", "dpto 302"]);
    expect(sql).toContain('"distrito"');
    expect(sql).toContain('"direccion_normalizada"');
    expect(sql).toContain('"departamento_normalizado"');
    expect(sql).not.toContain('"referencias"');
    expect(sql).not.toContain('"calle"');
    expect(sql).not.toContain('"numero"');
  });

  it("no consulta el hogar si el cliente ya tuvo la gratis", async () => {
    const { tx, consultas } = txCon([fila("confirmada", { usuarioId: "u1" })]);
    expect(await decidirLimpiezaGratis(tx, "u1", HOGAR)).toBe(false);
    expect(consultas).toHaveLength(1);
  });

  it("el hogar es obligatorio", async () => {
    const { tx } = txCon([]);
    // @ts-expect-error falta la clave del hogar
    const llamada = decidirLimpiezaGratis(tx, "u1");
    await llamada.catch(() => undefined);
  });
});
