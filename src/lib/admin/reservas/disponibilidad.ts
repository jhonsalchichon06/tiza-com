import { eq } from "drizzle-orm";
import { db } from "@/db/cliente";
import { reservas } from "@/db/esquema";
import type { Disponibilidad } from "../../agenda/disponibilidad";
import type { BaseDatos } from "../../agenda/expirar";
import { consultarDisponibilidadDeReserva, dependenciasPorDefecto, type DependenciasDisponibilidadPropia } from "../../reservas/disponibilidad-propia";

// Disponibilidad para que el ADMINISTRADOR reprograme una reserva a nombre del cliente (design de gestion-de-reservas-y-apoyo,
// decisión 7). Reutiliza el cálculo del ítem 12 (`consultarDisponibilidadDeReserva`: horas_agenda GUARDADAS y `excluirReservaId`
// para contar como libre el hueco de la propia reserva) y solo cambia cómo se carga la reserva: sin filtrar por dueño. Solo se
// expone bajo `requerirAdmin`; `GET /api/disponibilidad` no tiene ningún parámetro para excluir reservas.
export function dependenciasDeAdmin(base: () => Pick<BaseDatos, "select"> = () => db()): DependenciasDisponibilidadPropia {
  return {
    ...dependenciasPorDefecto(base),
    // El primer argumento (usuario) se ignora a propósito: el administrador ve la reserva de cualquier cliente.
    leerReserva: async (_usuarioId, reservaId) => {
      const [fila] = await base().select({ horasAgenda: reservas.horasAgenda }).from(reservas).where(eq(reservas.id, reservaId)).limit(1);
      return fila ? { horasAgenda: Number(fila.horasAgenda) } : null;
    },
  };
}

export function consultarDisponibilidadAdmin(
  { reservaId, fecha, ahora }: { reservaId: string; fecha: unknown; ahora: Date },
  dependencias: DependenciasDisponibilidadPropia = dependenciasDeAdmin(),
): Promise<Disponibilidad> {
  return consultarDisponibilidadDeReserva({ usuarioId: "administrador", reservaId, fecha, ahora }, dependencias);
}
