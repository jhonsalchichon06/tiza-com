import { and, eq, ne, sql } from "drizzle-orm";
import { reservas, resenas } from "@/db/esquema";
import { transaccionDeEscritura } from "../agenda/expirar";
import { ErrorApi } from "../errores";
import { esUuid } from "../uuid";
import { dependenciasPorDefecto, MENSAJE_RESERVA_NO_ENCONTRADA, type DependenciasResena, type RespuestaResena } from "./crear";
import { validarResena } from "./entrada";

export const MENSAJE_SIN_RESENA = "Todavía no dejaste una reseña de esta limpieza.";
export const MENSAJE_YA_PUBLICADA = "Tu reseña ya está publicada y no se puede cambiar.";

// Edita y reenvía la reseña propia mientras no esté aprobada (SUPUESTO del design, decisión 4: una rechazada se puede editar y
// reenviar). Una aprobada no se toca: si se pudiera, un cliente cambiaría el texto después de la aprobación y se saltaría la
// moderación. Se bloquean la reserva del dueño y la reseña (`FOR UPDATE`) y el UPDATE exige `estado <> 'aprobada'` en la misma
// sentencia: si el administrador aprueba a la vez, o la aprobación o la edición ve el estado nuevo y recibe 409, y nunca se
// publica un texto que el administrador no vio. Al guardar vuelve a `pendiente` y se limpia la revisión (lo exige el CHECK).
export async function editarResena(
  { usuarioId, reservaId, cuerpo }: { usuarioId: string; reservaId: string; cuerpo: unknown },
  dependencias: DependenciasResena = dependenciasPorDefecto,
): Promise<RespuestaResena> {
  if (!esUuid(reservaId)) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
  const datos = validarResena(cuerpo);
  return transaccionDeEscritura(async (tx) => {
    const [reserva] = await tx
      .select({ id: reservas.id })
      .from(reservas)
      .where(and(eq(reservas.id, reservaId), eq(reservas.usuarioId, usuarioId)))
      .for("update");
    if (!reserva) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);

    const [actual] = await tx.select({ id: resenas.id, estado: resenas.estado }).from(resenas).where(eq(resenas.reservaId, reserva.id)).for("update");
    if (!actual) throw ErrorApi.noEncontrado(MENSAJE_SIN_RESENA);
    if (actual.estado === "aprobada") throw ErrorApi.conflicto(MENSAJE_YA_PUBLICADA);

    const [editada] = await tx
      .update(resenas)
      .set({ estrellas: datos.estrellas, comentario: datos.comentario, estado: "pendiente", revisadaPor: null, revisadaEn: null, actualizadaEn: sql`now()` })
      .where(and(eq(resenas.id, actual.id), ne(resenas.estado, "aprobada")))
      .returning({ id: resenas.id, estrellas: resenas.estrellas, comentario: resenas.comentario, estado: resenas.estado });
    if (!editada) throw ErrorApi.conflicto(MENSAJE_YA_PUBLICADA);
    return editada;
  }, dependencias.base());
}
