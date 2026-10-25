import type { Configuracion } from "../configuracion";
import { diaDeLaSemana, horaLocal, iniciosDelDia, isoConZona, rangoBloqueado } from "./horario";

// Disponibilidad de un día por cupo. Función pura: recibe la ocupación ya leída. Es solo informativa;
// la verdad final la decide la restricción de exclusión al crear la reserva (ADR 0006 y 0007).

export type EquipoAgenda = { id: number; activo?: boolean };
export type Ocupacion = { equipoId: number; inicio: Date; finBloqueo: Date };
export type MotivoNoDisponible = "anticipacion" | "sin_cupo";
export type Horario = { hora: string; inicio: string; disponible: boolean; motivo?: MotivoNoDisponible };
export type Disponibilidad = { fecha: string; atendido: boolean; horarios: Horario[] };

type Entrada = {
  config: Configuracion;
  ahora: Date;
  fecha: string;
  horasAgenda: number;
  equipos: EquipoAgenda[];
  ocupadas: Ocupacion[];
};

// Rangos semiabiertos: terminar justo cuando empieza el otro no es solaparse.
const seSolapan = (aIni: Date, aFin: Date, bIni: Date, bFin: Date) => aIni < bFin && bIni < aFin;

export function calcularDisponibilidad({ config, ahora, fecha, horasAgenda, equipos, ocupadas }: Entrada): Disponibilidad {
  const { dias, zona } = config.horario_atencion;
  if (!dias.includes(diaDeLaSemana(fecha))) return { fecha, atendido: false, horarios: [] };

  const activos = equipos.filter((e) => e.activo !== false);
  const minimo = ahora.getTime() + config.anticipacion_minima_horas * 3_600_000;

  const horarios = iniciosDelDia(config, fecha, horasAgenda).map((inicio): Horario => {
    const base = { hora: horaLocal(inicio, zona), inicio: isoConZona(inicio, zona) };
    if (inicio.getTime() < minimo) return { ...base, disponible: false, motivo: "anticipacion" };

    const pedido = rangoBloqueado(config, inicio, horasAgenda);
    // Un equipo sirve solo si está libre durante todo el rango; el rango no se reparte entre equipos.
    const hayEquipoLibre = activos.some(
      (e) => !ocupadas.some((o) => o.equipoId === e.id && seSolapan(pedido.inicio, pedido.finBloqueo, o.inicio, o.finBloqueo)),
    );
    return hayEquipoLibre ? { ...base, disponible: true } : { ...base, disponible: false, motivo: "sin_cupo" };
  });

  return { fecha, atendido: true, horarios };
}
