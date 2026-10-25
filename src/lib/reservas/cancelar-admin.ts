import { eq, sql } from "drizzle-orm";
import { db } from "@/db/cliente";
import { reservas } from "@/db/esquema";
import { transaccionDeEscritura, type BaseDatos } from "../agenda/expirar";
import { cancelarComoAdminConCredito } from "../creditos/transiciones";
import { ErrorApi } from "../errores";
import { esUuid } from "../uuid";

export type DependenciasCancelarAdmin = { base: () => Pick<BaseDatos, "transaction"> };
const porDefecto: DependenciasCancelarAdmin = { base: () => db() };

export const MENSAJE_RESERVA_NO_ENCONTRADA = "No encontramos esa reserva.";
export const MENSAJE_RESERVA_EXPIRADA = "Esa reserva ya expiró y su horario ya está libre.";
export const MENSAJE_RESERVA_CONFIRMADA = "Esa reserva ya está confirmada: no se puede cancelar como comprobante falso desde aquí.";
export const MENSAJE_RESERVA_NO_PENDIENTE = "Esa reserva ya no está en espera, así que no se puede cancelar.";

export type RespuestaCancelacion = { reserva: { id: string; estado: string; cancelada_por: string | null; pago_id: string } };

// El administrador cancela una reserva `pendiente` (comprobante falso, PRD caso borde 9) y su horario queda libre en la
// misma transacción: `cancelada` sale del WHERE de la restricción de exclusión. NO modifica el pago ni la membresía: el
// pago sigue `pendiente` y el administrador lo rechaza (o lo aprueba si se equivocó: aprobación tardía).
// Solo `pendiente`: cancelar una `confirmada` es otra decisión (¿crédito?, ¿aviso al cliente?) que no es de este ítem.
//
// Crédito en horas (ítem 14, ADR 0012): guarda `cancelada_en` en el mismo UPDATE y devuelve a su lote original las horas de crédito que la reserva
// tenía `reservado`. Nunca genera un lote: la cancelación la causa Tiza, no el cliente (el pago puede reutilizarse).
export async function cancelarReservaComoAdmin(
  { reservaId }: { reservaId: string },
  dependencias: DependenciasCancelarAdmin = porDefecto,
): Promise<RespuestaCancelacion> {
  return transaccionDeEscritura(async (tx) => {
    if (!esUuid(reservaId)) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
    const [reserva] = await tx.select().from(reservas).where(eq(reservas.id, reservaId)).for("update");
    if (!reserva) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
    if (reserva.estado === "expirada") throw ErrorApi.conflicto(MENSAJE_RESERVA_EXPIRADA);
    if (reserva.estado === "confirmada") throw ErrorApi.conflicto(MENSAJE_RESERVA_CONFIRMADA);
    if (reserva.estado !== "pendiente") throw ErrorApi.conflicto(MENSAJE_RESERVA_NO_PENDIENTE);

    const [cancelada] = await tx
      .update(reservas)
      .set({ estado: "cancelada", canceladaPor: "admin", canceladaEn: sql`now()`, actualizadaEn: sql`now()` })
      .where(eq(reservas.id, reserva.id))
      .returning();
    await cancelarComoAdminConCredito(tx, cancelada);
    return { reserva: { id: cancelada.id, estado: cancelada.estado, cancelada_por: cancelada.canceladaPor, pago_id: cancelada.pagoId } };
  }, dependencias.base());
}
