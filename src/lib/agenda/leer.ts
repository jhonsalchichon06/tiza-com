import { and, asc, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { reservaActiva } from "@/db/reservas-activas";
import { equipos, reservas } from "@/db/esquema";
import type { EquipoAgenda, Ocupacion } from "./disponibilidad";
import type { BaseDatos } from "./expirar";

type Opciones = {
  desde: Date;
  hasta: Date;
  // Solo las pruebas contra Neon pasan equipos propios (inactivos). Por defecto cuentan los equipos activos.
  equipoIds?: number[];
  // Para reprogramar: deja libre el hueco de la reserva que el cliente está moviendo.
  excluirReservaId?: string;
};

// Lee equipos y ocupación de una ventana. Devuelve solo equipo e instantes: nada de datos de clientes.
// No escribe: una pendiente vencida no se trata como ocupada (reservaActiva) pero tampoco se marca aquí.
export async function leerOcupacion(
  base: Pick<BaseDatos, "select">,
  { desde, hasta, equipoIds, excluirReservaId }: Opciones,
): Promise<{ equipos: EquipoAgenda[]; ocupadas: Ocupacion[] }> {
  const filtroEquipos = equipoIds ? inArray(equipos.id, equipoIds) : eq(equipos.activo, true);
  const listaEquipos = await base.select({ id: equipos.id }).from(equipos).where(filtroEquipos).orderBy(asc(equipos.id));

  if (listaEquipos.length === 0) return { equipos: [], ocupadas: [] };

  const ocupadas = await base
    .select({ equipoId: reservas.equipoId, inicio: reservas.inicio, finBloqueo: reservas.finBloqueo })
    .from(reservas)
    .where(
      and(
        reservaActiva,
        inArray(reservas.equipoId, listaEquipos.map((e) => e.id)),
        lt(reservas.inicio, hasta),
        gt(reservas.finBloqueo, desde),
        excluirReservaId ? ne(reservas.id, excluirReservaId) : undefined,
      ),
    );

  return { equipos: listaEquipos, ocupadas };
}
