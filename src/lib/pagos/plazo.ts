import { sql } from "drizzle-orm";
import { pagos } from "@/db/esquema";

// Plazo para subir otro comprobante tras un rechazo (PRD, caso borde 1): `revisado_en` + `reenvio_comprobante_dias`,
// siempre medido con el `now()` de la base y nunca con el reloj del servidor. Un solo lugar para las tres consultas
// que lo usan (rechazar, listar, reenviar).

// Instante límite como texto ISO en UTC (se calcula en SQL para que una expresión no dependa del parser de tipos del driver).
export const reenvioHastaSql = (dias: number) =>
  sql<string | null>`to_char((${pagos.revisadoEn} + make_interval(days => ${dias}::int)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// Verdadero mientras el plazo no haya vencido.
export const reenvioVigenteSql = (dias: number) => sql<boolean>`(${pagos.revisadoEn} + make_interval(days => ${dias}::int)) > now()`;
