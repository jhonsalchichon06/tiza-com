import { sql, type SQL } from "drizzle-orm";
import type { Transaccion } from "../agenda/expirar";

// Las sentencias de conjunto del crédito (ADR 0012) se escriben en SQL para que cada una sea una sola operación atómica.
// `Ejecutor` es lo único que necesitan de la transacción (o de la base, si solo leen).
export type Ejecutor = Pick<Transaccion, "execute">;

// `execute` del driver devuelve `{ rows }`; un doble de prueba puede devolver directamente la lista.
export function filas<T = Record<string, unknown>>(resultado: unknown): T[] {
  if (Array.isArray(resultado)) return resultado as T[];
  const rows = (resultado as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

// (a, b, c) para un IN con parámetros.
export function lista(valores: string[]): SQL {
  return sql`(${sql.join(valores.map((v) => sql`${v}`), sql`, `)})`;
}

export const aNumero = (valor: unknown) => Number(valor);
export const aFecha = (valor: unknown) => (valor instanceof Date ? valor : new Date(String(valor)));
