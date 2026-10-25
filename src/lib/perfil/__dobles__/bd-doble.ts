import { PgDialect } from "drizzle-orm/pg-core";
import { equipos, fotosServicio, membresias, pagos, reservas, resenas, usuarios } from "@/db/esquema";

// Doble guionado de la base para probar las lecturas y escrituras del perfil sin red. Cada tabla tiene una cola de
// resultados (uno por sentencia, en orden; una función recibe la sentencia ya renderizada). Registra cada sentencia
// con su tabla, el bloqueo (`for update`), lo escrito y el SQL del WHERE, para comprobar el filtro por dueño y qué
// se modificó. La marca de vencidas de `transaccionDeEscritura` (UPDATE de reservas a `expirada` sin `cancelada_por`)
// se cuenta aparte y no consume la cola. `transaction` anidada = SAVEPOINT (se cuenta).

export type NombreTabla = "pagos" | "membresias" | "reservas" | "usuarios" | "equipos" | "resenas" | "fotos_servicio" | "creditos";
export type Sentencia = {
  tipo: "select" | "update" | "insert" | "execute";
  texto?: string;
  params?: unknown[];
  tabla: NombreTabla;
  bloqueo?: boolean;
  limite?: number;
  set?: Record<string, unknown>;
  valores?: unknown;
  donde?: { sql: string; params: unknown[] };
};
type Resultado = unknown[] | ((s: Sentencia) => unknown[] | Promise<unknown[]>);
export type Guion = Partial<Record<NombreTabla, Resultado[]>>;

const dialecto = new PgDialect();
export const render = (donde: unknown) => (donde ? dialecto.sqlToQuery(donde as Parameters<PgDialect["sqlToQuery"]>[0]) : undefined);

function nombreDe(tabla: unknown): NombreTabla {
  if (tabla === pagos) return "pagos";
  if (tabla === membresias) return "membresias";
  if (tabla === reservas) return "reservas";
  if (tabla === usuarios) return "usuarios";
  if (tabla === equipos) return "equipos";
  if (tabla === resenas) return "resenas";
  if (tabla === fotosServicio) return "fotos_servicio";
  throw new Error("tabla inesperada en el doble");
}

export function crearBdDoble(guion: Guion = {}, opciones: { falloEn?: (s: Sentencia) => Error | undefined } = {}) {
  const colas = Object.fromEntries(Object.entries(guion).map(([k, v]) => [k, [...(v as Resultado[])]])) as Record<string, Resultado[]>;
  const sentencias: Sentencia[] = [];
  const estado = { transacciones: 0, savepoints: 0, expiraciones: 0, deshecha: false };

  async function resolver(s: Sentencia): Promise<unknown[]> {
    const error = opciones.falloEn?.(s);
    if (error) throw error;
    const siguiente = colas[s.tabla]?.shift();
    if (siguiente === undefined) return [];
    return typeof siguiente === "function" ? siguiente(s) : siguiente;
  }

  function cadenaSelect(s: Sentencia) {
    const c: Record<string, unknown> = {};
    for (const m of ["innerJoin", "leftJoin", "orderBy", "groupBy", "offset"]) c[m] = () => c;
    c.where = (d: unknown) => {
      s.donde = render(d);
      return c;
    };
    c.for = () => {
      s.bloqueo = true;
      return c;
    };
    c.limit = (n: number) => {
      s.limite = n;
      return c;
    };
    c.then = (a: (v: unknown) => unknown, b: (e: unknown) => unknown) => resolver(s).then(a, b);
    return c;
  }

  const select = (columnas?: unknown) => ({
    from: (tabla: unknown) => {
      void columnas;
      const s: Sentencia = { tipo: "select", tabla: nombreDe(tabla) };
      sentencias.push(s);
      return cadenaSelect(s);
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Tx = { select: typeof select; execute: (consulta: Parameters<PgDialect["sqlToQuery"]>[0]) => Promise<{ rows: unknown[] }>; update: (t: unknown) => any; insert: (t: unknown) => any; transaction: <T>(fn: (t: Tx) => Promise<T>) => Promise<T> };
  const tx: Tx = {
    select,
    // Sentencias SQL del crédito en horas (ítem 14): cola "creditos", una entrada por sentencia.
    execute: async (consulta) => {
      const { sql, params } = dialecto.sqlToQuery(consulta);
      const s: Sentencia = { tipo: "execute", tabla: "creditos", texto: sql.replace(/\s+/g, " ").trim(), params };
      sentencias.push(s);
      return { rows: await resolver(s) };
    },
    update: (tabla: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (d: unknown) => {
          const nombre = nombreDe(tabla);
          const esMarcaDeVencidas = nombre === "reservas" && set.estado === "expirada" && !("canceladaPor" in set);
          const ejecutar = async () => {
            if (esMarcaDeVencidas) {
              estado.expiraciones++;
              return [];
            }
            const s: Sentencia = { tipo: "update", tabla: nombre, set, donde: render(d) };
            sentencias.push(s);
            return resolver(s);
          };
          return {
            returning: (_cols?: unknown) => ejecutar(),
            then: (a: (v: unknown) => unknown, b: (e: unknown) => unknown) => ejecutar().then(a, b),
          };
        },
      }),
    }),
    insert: (tabla: unknown) => ({
      values: (valores: unknown) => ({
        returning: async () => {
          const s: Sentencia = { tipo: "insert", tabla: nombreDe(tabla), valores };
          sentencias.push(s);
          return resolver(s);
        },
      }),
    }),
    // SAVEPOINT: si la función lanza, solo se deshace ese intento.
    transaction: async <T>(fn: (t: Tx) => Promise<T>): Promise<T> => {
      estado.savepoints++;
      return fn(tx);
    },
  };

  const base = {
    select,
    execute: tx.execute,
    transaction: async <T>(fn: (t: Tx) => Promise<T>): Promise<T> => {
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
    escrituras: () => sentencias.filter((s) => s.tipo !== "select" && s.tipo !== "execute"),
    ejecuciones: () => sentencias.filter((s) => s.tipo === "execute"),
    bloqueos: () => sentencias.filter((s) => s.bloqueo).map((s) => s.tabla),
    lecturas: () => sentencias.filter((s) => s.tipo === "select"),
  };
}
