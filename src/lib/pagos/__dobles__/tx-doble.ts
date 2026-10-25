import { PgDialect } from "drizzle-orm/pg-core";
import { membresias, pagos, reservas, usuarios } from "@/db/esquema";

// Doble guionado de la transacción para probar la lógica de revisión sin red. Cada tabla tiene una cola de resultados
// (uno por sentencia, en orden). Registra cada sentencia: su tabla, el modo (`for update`) y lo escrito, para comprobar
// qué se bloqueó y qué se modificó. La marca de vencidas de `transaccionDeEscritura` (UPDATE de reservas con
// estado `expirada`) se registra aparte y no consume la cola.

// "creditos" es la cola de las sentencias SQL de crédito (`tx.execute`, ítem 14): una entrada por sentencia, en orden.
type NombreTabla = "pagos" | "membresias" | "reservas" | "usuarios" | "creditos";
export type Guion = Partial<Record<NombreTabla, unknown[][]>>;
export type Sentencia = {
  tipo: "select" | "update" | "insert" | "execute";
  texto?: string;
  params?: unknown[];
  tabla: NombreTabla;
  bloqueo?: boolean;
  set?: Record<string, unknown>;
  valores?: unknown;
  donde?: { sql: string; params: unknown[] };
  returning?: Record<string, unknown> | boolean;
};

const dialecto = new PgDialect();
export const render = (donde: unknown) => (donde ? dialecto.sqlToQuery(donde as Parameters<PgDialect["sqlToQuery"]>[0]) : undefined);

function nombreDe(tabla: unknown): NombreTabla {
  if (tabla === pagos) return "pagos";
  if (tabla === membresias) return "membresias";
  if (tabla === reservas) return "reservas";
  if (tabla === usuarios) return "usuarios";
  throw new Error("tabla inesperada en el doble");
}

export function crearTxDoble(guion: Guion = {}, opciones: { falloEn?: (s: Sentencia) => Error | undefined } = {}) {
  const colas: Guion = Object.fromEntries(Object.entries(guion).map(([k, v]) => [k, [...(v as unknown[][])]]));
  const sentencias: Sentencia[] = [];
  const estado = { transacciones: 0, expiraciones: 0, deshecha: false };
  const siguiente = (tabla: NombreTabla) => (colas[tabla]?.shift() as unknown[] | undefined) ?? [];

  function cadenaSelect(sentencia: Sentencia) {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "leftJoin", "orderBy", "groupBy"]) c[m] = () => c;
    c.where = (d: unknown) => {
      sentencia.donde = render(d);
      return c;
    };
    c.for = () => {
      sentencia.bloqueo = true;
      return c;
    };
    const resolver = async () => {
      const error = opciones.falloEn?.(sentencia);
      if (error) throw error;
      return siguiente(sentencia.tabla);
    };
    c.limit = resolver;
    c.then = (a: (v: unknown) => unknown, b: (e: unknown) => unknown) => resolver().then(a, b);
    return c;
  }

  const tx = {
    execute: async (consulta: Parameters<typeof dialecto.sqlToQuery>[0]) => {
      const { sql, params } = dialecto.sqlToQuery(consulta);
      const sentencia: Sentencia = { tipo: "execute", tabla: "creditos", texto: sql.replace(/\s+/g, " ").trim(), params };
      sentencias.push(sentencia);
      const error = opciones.falloEn?.(sentencia);
      if (error) throw error;
      return { rows: siguiente("creditos") };
    },
    select: () => ({
      from: (tabla: unknown) => {
        const sentencia: Sentencia = { tipo: "select", tabla: nombreDe(tabla) };
        sentencias.push(sentencia);
        return cadenaSelect(sentencia);
      },
    }),
    update: (tabla: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (d: unknown) => ({
          returning: async (cols?: Record<string, unknown>) => {
            const nombre = nombreDe(tabla);
            if (nombre === "reservas" && set.estado === "expirada") {
              estado.expiraciones++;
              return [];
            }
            const sentencia: Sentencia = { tipo: "update", tabla: nombre, set, donde: render(d), returning: cols ?? true };
            sentencias.push(sentencia);
            const error = opciones.falloEn?.(sentencia);
            if (error) throw error;
            return siguiente(nombre);
          },
        }),
      }),
    }),
    insert: (tabla: unknown) => ({
      values: (valores: unknown) => ({
        returning: async () => {
          const sentencia: Sentencia = { tipo: "insert", tabla: nombreDe(tabla), valores };
          sentencias.push(sentencia);
          const error = opciones.falloEn?.(sentencia);
          if (error) throw error;
          return siguiente(sentencia.tabla);
        },
      }),
    }),
  };

  const base = {
    transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => {
      estado.transacciones++;
      try {
        return await fn(tx);
      } catch (error) {
        estado.deshecha = true;
        throw error;
      }
    },
  };

  return {
    base: base as never,
    estado,
    sentencias,
    // Lo escrito (UPDATE e INSERT) sin la marca de vencidas.
    escrituras: () => sentencias.filter((s) => s.tipo !== "select" && s.tipo !== "execute"),
    // Las sentencias SQL de crédito (`tx.execute`), con su texto y parámetros.
    ejecuciones: () => sentencias.filter((s) => s.tipo === "execute"),
    bloqueos: () => sentencias.filter((s) => s.bloqueo).map((s) => s.tabla),
  };
}
