import { and, eq } from "drizzle-orm";
import { db } from "@/db/cliente";
import { reservas, resenas } from "@/db/esquema";
import { transaccionDeEscritura, type BaseDatos } from "../agenda/expirar";
import { ErrorApi } from "../errores";
import { esUuid } from "../uuid";
import { validarResena } from "./entrada";
import type { EstadoResena } from "./textos";

export const MENSAJE_RESERVA_NO_ENCONTRADA = "No encontramos esa reserva.";
export const MENSAJE_YA_RESENADA = "Ya dejaste tu reseña de esta limpieza.";
export const MENSAJES_NO_RESENABLE: Record<"pendiente" | "confirmada" | "cancelada" | "expirada", string> = {
  pendiente: "Todavía no puedes reseñar: esta reserva espera la aprobación de tu pago.",
  confirmada: "Podrás dejar tu reseña cuando se complete la limpieza.",
  cancelada: "Esa reserva se canceló, así que no se puede reseñar.",
  expirada: "Esa reserva expiró, así que no se puede reseñar.",
};

export type RespuestaResena = { id: string; estrellas: number; comentario: string; estado: EstadoResena };
export type DependenciasResena = { base: () => Pick<BaseDatos, "transaction"> };
export const dependenciasPorDefecto: DependenciasResena = { base: () => db() };

const codigoDe = (valor: unknown): unknown => (typeof valor === "object" && valor !== null ? (valor as { code?: unknown }).code : undefined);
const esClaveDuplicada = (error: unknown) => codigoDe(error) === "23505" || codigoDe((error as { cause?: unknown } | null)?.cause) === "23505";

// El cliente escribe la reseña de UNA limpieza suya y completada (PRD, alcance 7). La reserva se busca con el `usuario_id` de
// la sesión en el mismo WHERE (ADR 0005): una ajena, inexistente o con mal formato da el mismo 404, también para un
// administrador que no es el dueño. Dentro de `transaccionDeEscritura` la reserva se bloquea (`FOR UPDATE`) y se exige
// `completada`; el INSERT lo respalda la clave única de `reserva_id`, así que dos peticiones simultáneas pasan la
// comprobación pero solo una inserta: la otra recibe 23505, que se traduce a 409 (ADR 0002: la garantía real es la restricción).
// Un COMMIT perdido seguido de reintento también acaba en ese 409, que es verdad y no duplica nada.
export async function crearResena(
  { usuarioId, reservaId, cuerpo }: { usuarioId: string; reservaId: string; cuerpo: unknown },
  dependencias: DependenciasResena = dependenciasPorDefecto,
): Promise<RespuestaResena> {
  if (!esUuid(reservaId)) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
  const datos = validarResena(cuerpo);
  try {
    return await transaccionDeEscritura(async (tx) => {
      const [reserva] = await tx
        .select({ id: reservas.id, estado: reservas.estado })
        .from(reservas)
        .where(and(eq(reservas.id, reservaId), eq(reservas.usuarioId, usuarioId)))
        .for("update");
      if (!reserva) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
      if (reserva.estado !== "completada") throw ErrorApi.conflicto(MENSAJES_NO_RESENABLE[reserva.estado]);

      const [creada] = await tx
        .insert(resenas)
        .values({ reservaId: reserva.id, estrellas: datos.estrellas, comentario: datos.comentario })
        .returning({ id: resenas.id, estrellas: resenas.estrellas, comentario: resenas.comentario, estado: resenas.estado });
      return creada;
    }, dependencias.base());
  } catch (error) {
    if (esClaveDuplicada(error)) throw ErrorApi.conflicto(MENSAJE_YA_RESENADA);
    throw error;
  }
}
