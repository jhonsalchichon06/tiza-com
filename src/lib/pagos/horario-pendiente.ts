import { and, asc, eq, sql } from "drizzle-orm";
import { pagos, reservas } from "@/db/esquema";
import { reservaQueCuentaParaGratis } from "@/db/reservas-activas";
import type { BaseDatos } from "../agenda/expirar";

export type PagoConHorarioPendiente = {
  id: string;
  usuarioId: string;
  membresiaId: string | null;
  concepto: "membresia" | "reserva" | "membresia_y_reserva";
  monto: number;
  revisadoEn: Date | null;
};

// Definición ÚNICA del estado "debe elegir un nuevo día y hora" (ADR 0009, aprobación tardía): pagos `aprobado` sin
// ninguna reserva `pendiente` vigente, `confirmada` ni `completada` (la condición de `reservaQueCuentaParaGratis`, que
// cuenta lo vivo o realizado y no lo `expirado`, `cancelado` ni lo vencido sin marcar). Se deriva y no se guarda: un
// indicador en `pagos` se desincronizaría con cada reserva que nace o se cancela.
//
// El ítem 12 muestra «Elige un nuevo día y hora» en el perfil con esta consulta; el ítem 13 crea la reserva `confirmada`
// (sin espera ni comprobante) que apunta al MISMO `pago_id`. Con `usuarioId` filtra al cliente.
export async function pagosConHorarioPendiente(base: Pick<BaseDatos, "select">, usuarioId?: string): Promise<PagoConHorarioPendiente[]> {
  return base
    .select({
      id: pagos.id,
      usuarioId: pagos.usuarioId,
      membresiaId: pagos.membresiaId,
      concepto: pagos.concepto,
      monto: pagos.monto,
      revisadoEn: pagos.revisadoEn,
    })
    .from(pagos)
    .where(
      and(
        eq(pagos.estado, "aprobado"),
        usuarioId === undefined ? undefined : eq(pagos.usuarioId, usuarioId),
        sql`NOT EXISTS (SELECT 1 FROM ${reservas} WHERE ${reservas.pagoId} = ${pagos.id} AND (${reservaQueCuentaParaGratis}))`,
        // Un pago de solo membresía que NUNCA tuvo reserva es una renovación (renovacion-del-mes-4): pagó el período, no una
        // limpieza, así que no deja ningún horario por elegir ni nada que reutilizar. Un pago `membresia` cuya reserva
        // expiró sí la tiene (fila `expirada`) y sigue siendo aprobación tardía.
        sql`NOT (${pagos.concepto} = 'membresia' AND NOT EXISTS (SELECT 1 FROM ${reservas} WHERE ${reservas.pagoId} = ${pagos.id}))`,
      ),
    )
    .orderBy(asc(pagos.revisadoEn));
}
