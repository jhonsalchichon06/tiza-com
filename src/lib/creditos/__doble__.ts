import { PgDialect } from "drizzle-orm/pg-core";

// Doble de `tx.execute` para probar las sentencias de crédito sin red: devuelve una cola de resultados (uno por sentencia, en
// orden) y registra el SQL renderizado con sus parámetros.
const dialecto = new PgDialect();

export type SentenciaRegistrada = { sql: string; params: unknown[] };

export function crearEjecutorDoble(resultados: unknown[][] = []) {
  const cola = [...resultados];
  const sentencias: SentenciaRegistrada[] = [];
  const tx = {
    execute: async (consulta: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const { sql, params } = dialecto.sqlToQuery(consulta);
      sentencias.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      return { rows: cola.shift() ?? [] };
    },
  };
  return { tx: tx as never, sentencias };
}
