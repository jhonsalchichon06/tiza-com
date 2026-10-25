import { eq, sql } from "drizzle-orm";
import { db } from "@/db/cliente";
import { reservas } from "@/db/esquema";
import { transaccionDeEscritura, type BaseDatos } from "../../agenda/expirar";
import { ErrorApi } from "../../errores";
import { esUuid } from "../../uuid";
import type { EstadoEfectivo } from "./estado";

export const MENSAJE_RESERVA_NO_ENCONTRADA = "No encontramos esa reserva.";
export const MENSAJE_AUN_NO_EMPIEZA = "El servicio todavía no empieza.";
export const MENSAJES_NO_COMPLETABLE: Record<Exclude<EstadoEfectivo, "confirmada">, string> = {
  pendiente: "Esa reserva espera la aprobación de su pago: primero debe aprobarse el pago.",
  cancelada: "Esa reserva está cancelada, así que no se puede completar.",
  expirada: "Esa reserva expiró, así que no se puede completar.",
  completada: "Esa reserva ya está completada.",
};

// Decide si se puede completar. Función pura para probar cada caso sin base. `ok` solo para una `confirmada` cuyo servicio
// ya empezó; en los demás casos, el mensaje del 409 (uno por caso).
export function evaluarCompletar({ estadoEfectivo, yaEmpezo }: { estadoEfectivo: EstadoEfectivo; yaEmpezo: boolean }): "ok" | string {
  if (estadoEfectivo !== "confirmada") return MENSAJES_NO_COMPLETABLE[estadoEfectivo];
  if (!yaEmpezo) return MENSAJE_AUN_NO_EMPIEZA;
  return "ok";
}

export type DependenciasCompletar = { base: () => Pick<BaseDatos, "transaction"> };
const porDefecto: DependenciasCompletar = { base: () => db() };

export type RespuestaCompletar = { reserva: { id: string; estado: "completada" } };

// El administrador marca a mano una limpieza como realizada (PRD, alcance 9). Solo una `confirmada` cuyo `inicio` ya ocurrió,
// comparado con el reloj de la base. La fila se bloquea (`FOR UPDATE`): dos administradores a la vez, o un cliente que
// cancela (ítem 12), se serializan y el segundo ve el estado nuevo y recibe 409.
//
// `transaccionDeEscritura` marca las vencidas al abrir, así que una `pendiente` cuya espera acaba de vencer llega aquí ya
// como `expirada`; `now()` es el mismo instante durante toda la transacción.
//
// Completar saca la reserva de la restricción de exclusión (solo cubre `pendiente` y `confirmada`) y libera el cupo del
// equipo. No es un riesgo: solo se completa un servicio que ya empezó y toda reserva nueva exige al menos 48 horas de
// anticipación, así que no puede existir una reserva futura que choque con un rango en curso.
//
// No toca el pago, la membresía ni el equipo. Los ítems 17 (fotos) y 18 (reseñas) dependen de este estado `completada`:
// solo una limpieza completada puede tener fotos y reseña.
export async function completarReserva(
  { reservaId }: { reservaId: string },
  dependencias: DependenciasCompletar = porDefecto,
): Promise<RespuestaCompletar> {
  if (!esUuid(reservaId)) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
  return transaccionDeEscritura(async (tx) => {
    const [reserva] = await tx
      .select({ id: reservas.id, estado: reservas.estado, yaEmpezo: sql<boolean>`(${reservas.inicio} <= now())` })
      .from(reservas)
      .where(eq(reservas.id, reservaId))
      .for("update");
    if (!reserva) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);

    const veredicto = evaluarCompletar({ estadoEfectivo: reserva.estado, yaEmpezo: Boolean(reserva.yaEmpezo) });
    if (veredicto !== "ok") throw ErrorApi.conflicto(veredicto);

    const [completada] = await tx
      .update(reservas)
      .set({ estado: "completada", actualizadaEn: sql`now()` })
      .where(eq(reservas.id, reserva.id))
      .returning({ id: reservas.id });
    return { reserva: { id: completada.id, estado: "completada" as const } };
  }, dependencias.base());
}
