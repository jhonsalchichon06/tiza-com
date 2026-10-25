import { eq, sql, type SQL } from "drizzle-orm";
import { reservas } from "@/db/esquema";
import { ErrorApi } from "../errores";
import { esConflictoDeExclusion } from "./errores-bd";
import type { Transaccion } from "./expirar";

// `expiraEn` admite una expresión SQL (`now() + …`) para fijar el plazo con el reloj de la base.
export type FilaReserva = Omit<typeof reservas.$inferInsert, "equipoId" | "expiraEn"> & { expiraEn?: Date | SQL | null };
export type ReservaGuardada = typeof reservas.$inferSelect;

export const MENSAJE_SIN_CUPO = "Esa hora ya no está disponible. Elige otra hora.";

// Inserta la reserva en el primer equipo que la base de datos acepte (ADR 0007 y 0009).
// Cada intento va en un SAVEPOINT: un rechazo de la restricción de exclusión (23P01) no aborta la transacción
// del llamante y permite probar el siguiente equipo. Cualquier otro error se propaga tal cual.
// El llamante la usa dentro de `transaccionDeEscritura`; no se reimplementa el savepoint en otro lado.
export async function insertarEnPrimerEquipoLibre(
  tx: Pick<Transaccion, "transaction">,
  equipoIds: number[],
  fila: FilaReserva,
): Promise<ReservaGuardada> {
  for (const equipoId of equipoIds) {
    try {
      return await tx.transaction(async (savepoint) => {
        const [guardada] = await savepoint.insert(reservas).values({ ...fila, equipoId }).returning();
        return guardada;
      });
    } catch (error) {
      if (esConflictoDeExclusion(error)) continue;
      throw error;
    }
  }
  throw ErrorApi.conflicto(MENSAJE_SIN_CUPO);
}

export type CambiosDeHorario = {
  inicio: Date;
  fin: Date;
  finBloqueo: Date;
  // `undefined` no toca la columna; `null` o un estado la fija.
  apoyoEstado?: ReservaGuardada["apoyoEstado"];
};

// Mueve una reserva ya existente al primer equipo que la base acepte (reprogramar, perfil-reservas-y-membresia). Es
// hermana de `insertarEnPrimerEquipoLibre` con el mismo patrón (un SAVEPOINT por equipo, 23P01 pasa al siguiente, 409 si
// ninguno acepta) pero hace un UPDATE: conserva el `id`, el pago, el precio, el estado y `primera_gratis`. El llamante pone
// primero el equipo actual. La restricción de exclusión no compara la fila con su propia versión anterior, así que
// mover una reserva a un rango que se solapa con el suyo viejo no choca consigo misma. Va dentro de `transaccionDeEscritura`.
export async function moverAlPrimerEquipoLibre(
  tx: Pick<Transaccion, "transaction">,
  reservaId: string,
  equipoIds: number[],
  cambios: CambiosDeHorario,
): Promise<ReservaGuardada> {
  for (const equipoId of equipoIds) {
    try {
      return await tx.transaction(async (savepoint) => {
        const [movida] = await savepoint
          .update(reservas)
          .set({
            equipoId,
            inicio: cambios.inicio,
            fin: cambios.fin,
            finBloqueo: cambios.finBloqueo,
            apoyoEstado: cambios.apoyoEstado,
            actualizadaEn: sql`now()`,
          })
          .where(eq(reservas.id, reservaId))
          .returning();
        return movida;
      });
    } catch (error) {
      if (esConflictoDeExclusion(error)) continue;
      throw error;
    }
  }
  throw ErrorApi.conflicto(MENSAJE_SIN_CUPO);
}
