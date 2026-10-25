import { sql } from "drizzle-orm";
import { aFecha, aNumero, filas, type Ejecutor } from "./sql";

export type LoteGenerado = { id: string; horas: number; venceEn: Date };

// Genera el lote de crédito de una reserva cancelada por el CLIENTE cuyo pago está `aprobado` (ADR 0012). Una sola sentencia
// idempotente con toda la condición en SQL: la llaman la cancelación del cliente (si el pago ya estaba aprobado) y la
// aprobación del pago (si la reserva ya estaba cancelada), en el orden en que ocurran. El índice único sobre
// `reserva_origen_id` cubre cualquier doble ejecución.
//
// Horas del lote = horas de trabajo − horas gratis − crédito aplicado (lo pagado en dinero). Las 3 horas gratis de una primera
// limpieza no pasan a crédito: se reusan en la siguiente reserva (ADR 0008). Vence `credito_vence_meses` después de la
// cancelación (`cancelada_en`), no de la creación del lote. `mesesVence` sale de `configuracion`.
// Devuelve el lote creado o `null` si no cumplía la condición o ya existía.
export async function generarCreditoDeCancelacion(tx: Ejecutor, reservaId: string, mesesVence: number): Promise<LoteGenerado | null> {
  const resultado = await tx.execute(sql`
    INSERT INTO "creditos_horas" ("usuario_id", "reserva_origen_id", "horas_iniciales", "horas_disponibles", "vence_en")
    SELECT r."usuario_id", r."id",
      r."horas_trabajo" - r."horas_gratis_aplicadas" - r."credito_aplicado",
      r."horas_trabajo" - r."horas_gratis_aplicadas" - r."credito_aplicado",
      r."cancelada_en" + make_interval(months => ${mesesVence}::int)
    FROM "reservas" r
    JOIN "pagos" p ON p."id" = r."pago_id"
    WHERE r."id" = ${reservaId} AND r."estado" = 'cancelada' AND r."cancelada_por" = 'cliente' AND r."cancelada_en" IS NOT NULL
      AND p."estado" = 'aprobado'
      AND r."horas_trabajo" - r."horas_gratis_aplicadas" - r."credito_aplicado" > 0
    ON CONFLICT ("reserva_origen_id") DO NOTHING
    RETURNING "id", "horas_iniciales", "vence_en"`);
  const [fila] = filas<{ id: string; horas_iniciales: string; vence_en: Date | string }>(resultado);
  return fila ? { id: fila.id, horas: aNumero(fila.horas_iniciales), venceEn: aFecha(fila.vence_en) } : null;
}
