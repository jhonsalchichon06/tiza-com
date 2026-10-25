import { and, eq } from "drizzle-orm";
import { db } from "@/db/cliente";
import { reservas } from "@/db/esquema";
import { calcularDisponibilidad, type Disponibilidad, type EquipoAgenda, type Ocupacion } from "../agenda/disponibilidad";
import type { BaseDatos } from "../agenda/expirar";
import { instanteLocal, validarFecha } from "../agenda/horario";
import { leerOcupacion } from "../agenda/leer";
import { leerConfiguracion, type Configuracion } from "../configuracion";
import { ErrorApi } from "../errores";
import { esUuid } from "../uuid";
import { MENSAJE_RESERVA_NO_ENCONTRADA } from "./cancelar";

// Disponibilidad para reprogramar (perfil-reservas-y-membresia, decisión 7). Es una ruta del DUEÑO: carga su reserva
// (404 si no es suya) y calcula con las `horas_agenda` GUARDADAS, dejando libre el hueco de la propia reserva con
// `excluirReservaId`. No existe un parámetro público para excluir una reserva cualquiera: `GET /api/disponibilidad` no
// cambia, así nadie puede "liberar" en su vista la reserva de otro para deducir ocupación ajena.

export type DependenciasDisponibilidadPropia = {
  leerReserva: (usuarioId: string, reservaId: string) => Promise<{ horasAgenda: number } | null>;
  leerConfig: () => Promise<Configuracion>;
  leerOcupacion: (ventana: { desde: Date; hasta: Date; excluirReservaId: string }) => Promise<{ equipos: EquipoAgenda[]; ocupadas: Ocupacion[] }>;
};

export function dependenciasPorDefecto(base: () => Pick<BaseDatos, "select"> = () => db()): DependenciasDisponibilidadPropia {
  return {
    leerReserva: async (usuarioId, reservaId) => {
      const [fila] = await base()
        .select({ horasAgenda: reservas.horasAgenda })
        .from(reservas)
        .where(and(eq(reservas.id, reservaId), eq(reservas.usuarioId, usuarioId)))
        .limit(1);
      return fila ? { horasAgenda: Number(fila.horasAgenda) } : null;
    },
    leerConfig: () => leerConfiguracion(),
    leerOcupacion: (ventana) => leerOcupacion(base(), ventana),
  };
}

export async function consultarDisponibilidadDeReserva(
  { usuarioId, reservaId, fecha, ahora }: { usuarioId: string; reservaId: string; fecha: unknown; ahora: Date },
  dependencias: DependenciasDisponibilidadPropia = dependenciasPorDefecto(),
): Promise<Disponibilidad> {
  if (!esUuid(reservaId)) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
  const reserva = await dependencias.leerReserva(usuarioId, reservaId);
  if (!reserva) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
  const dia = validarFecha(fecha);

  const config = await dependencias.leerConfig();
  const desde = instanteLocal(dia, "00:00", config.horario_atencion.zona);
  const hasta = new Date(desde.getTime() + 30 * 3_600_000);
  const { equipos, ocupadas } = await dependencias.leerOcupacion({ desde, hasta, excluirReservaId: reservaId });
  return calcularDisponibilidad({ config, ahora, fecha: dia, horasAgenda: reserva.horasAgenda, equipos, ocupadas });
}
