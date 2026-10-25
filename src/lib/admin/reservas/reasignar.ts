import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/cliente";
import { equipos, reservas } from "@/db/esquema";
import { esConflictoDeExclusion } from "../../agenda/errores-bd";
import { transaccionDeEscritura, type BaseDatos } from "../../agenda/expirar";
import { ErrorApi } from "../../errores";
import { esUuid } from "../../uuid";
import { validar } from "../../validacion-sesion";
import { MENSAJE_RESERVA_NO_ENCONTRADA } from "./completar";
import { esViva, NOMBRE_DEL_ESTADO, type EstadoEfectivo } from "./estado";

export const MENSAJE_EQUIPO_INACTIVO = "Elige un equipo activo.";
export const MENSAJE_MISMO_EQUIPO = "La reserva ya está en ese equipo.";
export const MENSAJE_EQUIPO_OCUPADO = "Ese equipo no está libre en ese horario.";

export const esquemaReasignar = z.object({
  equipo_id: z
    .number({ error: "Elige un equipo activo." })
    .int({ error: "Elige un equipo activo." })
    .positive({ error: "Elige un equipo activo." }),
});

export type DependenciasReasignar = {
  base: () => Pick<BaseDatos, "transaction">;
  // Solo las pruebas contra Neon lo desactivan (usan equipos INACTIVOS para no tocar la agenda real). La regla de «equipo
  // activo» se prueba aparte con dobles.
  exigirActivo?: boolean;
};
const porDefecto: DependenciasReasignar = { base: () => db(), exigirActivo: true };

export type RespuestaReasignar = { reserva: { id: string; estado: EstadoEfectivo; equipo_id: number } };

// Mueve una reserva viva a otro equipo, solo si está libre en todo su rango bloqueado (ADR 0007). La decisión de «está libre»
// es de la restricción de exclusión de la base: una consulta previa tendría una carrera con un cliente que reserva ese mismo
// hueco. El UPDATE va en un SAVEPOINT (`tx.transaction`) para que el rechazo `23P01` no aborte la transacción y se pueda
// responder un 409 limpio, igual que `insertarEnPrimerEquipoLibre`. El rango no cambia: con la misma duración el único
// choque posible es con las reservas del equipo destino. No toca estado, pago ni `expira_en`.
export async function reasignarReserva(
  { reservaId, cuerpo }: { reservaId: string; cuerpo: unknown },
  dependencias: DependenciasReasignar = porDefecto,
): Promise<RespuestaReasignar> {
  const { equipo_id: destino } = validar(esquemaReasignar, cuerpo);
  if (!esUuid(reservaId)) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
  const exigirActivo = dependencias.exigirActivo ?? true;

  return transaccionDeEscritura(async (tx) => {
    const [reserva] = await tx
      .select({ id: reservas.id, estado: reservas.estado, equipoId: reservas.equipoId })
      .from(reservas)
      .where(eq(reservas.id, reservaId))
      .for("update");
    if (!reserva) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
    // Las vencidas ya se marcaron al abrir la transacción: una `pendiente` vencida llega como `expirada`.
    if (!esViva(reserva.estado)) throw ErrorApi.conflicto(`Esa reserva está ${NOMBRE_DEL_ESTADO[reserva.estado]}, así que no se puede cambiar de equipo.`);

    const [equipo] = await tx.select({ id: equipos.id, activo: equipos.activo }).from(equipos).where(eq(equipos.id, destino)).limit(1);
    if (!equipo || (exigirActivo && !equipo.activo)) throw ErrorApi.invalido(MENSAJE_EQUIPO_INACTIVO);
    if (equipo.id === reserva.equipoId) throw ErrorApi.invalido(MENSAJE_MISMO_EQUIPO);

    try {
      const movida = await tx.transaction(async (savepoint) => {
        const [fila] = await savepoint
          .update(reservas)
          .set({ equipoId: equipo.id, actualizadaEn: sql`now()` })
          .where(eq(reservas.id, reserva.id))
          .returning({ id: reservas.id, estado: reservas.estado, equipoId: reservas.equipoId });
        return fila;
      });
      return { reserva: { id: movida.id, estado: movida.estado, equipo_id: movida.equipoId } };
    } catch (error) {
      if (esConflictoDeExclusion(error)) throw new ErrorApi(409, "equipo_ocupado", MENSAJE_EQUIPO_OCUPADO);
      throw error;
    }
  }, dependencias.base());
}
