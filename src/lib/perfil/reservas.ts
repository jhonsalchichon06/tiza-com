import { and, asc, desc, eq, gt, not, sql } from "drizzle-orm";
import { fotosServicio, reservas, resenas } from "@/db/esquema";
import { reservaActiva } from "@/db/reservas-activas";
import type { BaseDatos } from "../agenda/expirar";
import { isoConZona } from "../agenda/horario";
import type { Configuracion } from "../configuracion";

// Lecturas de reservas del perfil. Toda consulta lleva `usuario_id` de la sesión en el WHERE (ADR 0005) y NINGUNA
// devuelve `equipo_id`: el equipo es interno (PRD, no alcance). El estado "efectivo" se calcula con el reloj de la base.

const HORA_MS = 3_600_000;
export const LIMITE_HISTORIAL = 50;

export type ConfigPerfil = Pick<Configuracion, "cancelacion_minima_horas" | "horario_atencion">;

export type EstadoEfectivo = "pendiente" | "confirmada" | "completada" | "cancelada" | "expirada" | "pendiente_de_cierre";

export const TEXTO_ESTADO: Record<EstadoEfectivo, string> = {
  pendiente: "Esperando la aprobación de tu pago",
  confirmada: "Confirmada",
  completada: "Completada",
  cancelada: "Cancelada",
  expirada: "Expirada",
  pendiente_de_cierre: "Servicio realizado, pendiente de cierre",
};

export type ServicioVista =
  | { tipo: "estandar" | "profunda" | "mudanza"; dormitorios: number; banos: number }
  | { tipo: "paquete"; horas: number };

export type DireccionVista = { distrito: string; calle: string; numero: string; departamento: string | null; referencias: string | null };

export type ReservaVista = {
  id: string;
  estado: EstadoEfectivo;
  estado_texto: string;
  servicio: ServicioVista;
  direccion: DireccionVista;
  inicio: string;
  fin: string;
  monto: number;
  precio_lista: number;
  horas_gratis_aplicadas: number;
  requiere_apoyo: boolean;
  expira_en: string | null;
  enlace: string;
};

export type ProximaVista = ReservaVista & { puede_reprogramar: boolean; puede_cancelar: boolean };

// Columnas que el perfil lee de `reservas`: sin `equipo_id` y sin identificadores de otros clientes.
export const columnasDeVista = {
  id: reservas.id,
  estado: reservas.estado,
  tipo: reservas.tipo,
  dormitorios: reservas.dormitorios,
  banos: reservas.banos,
  horasTrabajo: reservas.horasTrabajo,
  requiereApoyo: reservas.requiereApoyo,
  distrito: reservas.distrito,
  calle: reservas.calle,
  numero: reservas.numero,
  departamento: reservas.departamento,
  referencias: reservas.referencias,
  inicio: reservas.inicio,
  fin: reservas.fin,
  precioLista: reservas.precioLista,
  horasGratisAplicadas: reservas.horasGratisAplicadas,
  monto: reservas.monto,
  expiraEn: reservas.expiraEn,
  // Con el reloj de la base: una pendiente vencida se muestra `expirada` aunque nadie la haya marcado todavía.
  vencida: sql<boolean>`(${reservas.estado} = 'pendiente' AND ${reservas.expiraEn} <= now())`,
  yaEmpezo: sql<boolean>`(${reservas.inicio} <= now())`,
};

export type FilaVista = {
  id: string;
  estado: "pendiente" | "confirmada" | "completada" | "cancelada" | "expirada";
  tipo: "estandar" | "profunda" | "mudanza" | "paquete";
  dormitorios: number | null;
  banos: number | null;
  horasTrabajo: string;
  requiereApoyo: boolean;
  distrito: string;
  calle: string;
  numero: string;
  departamento: string | null;
  referencias: string | null;
  inicio: Date;
  fin: Date;
  precioLista: number;
  horasGratisAplicadas: string;
  monto: number;
  expiraEn: Date | null;
  vencida: boolean;
  yaEmpezo: boolean;
};

// 24 horas exactas todavía se permite ("hasta 24 horas antes", PRD punto 7).
export function dentroDelPlazo(config: Pick<Configuracion, "cancelacion_minima_horas">, ahora: Date, inicio: Date): boolean {
  return inicio.getTime() - ahora.getTime() >= config.cancelacion_minima_horas * HORA_MS;
}

export function estadoEfectivo(f: Pick<FilaVista, "estado" | "vencida" | "yaEmpezo">): EstadoEfectivo {
  if (f.estado === "pendiente" && f.vencida) return "expirada";
  if (f.estado === "confirmada" && f.yaEmpezo) return "pendiente_de_cierre";
  return f.estado;
}

export function aServicioVista(f: Pick<FilaVista, "tipo" | "dormitorios" | "banos" | "horasTrabajo">): ServicioVista {
  if (f.tipo === "paquete") return { tipo: "paquete", horas: Number(f.horasTrabajo) };
  return { tipo: f.tipo, dormitorios: f.dormitorios ?? 0, banos: f.banos ?? 0 };
}

export function aReservaVista(f: FilaVista, zona: string): ReservaVista {
  const estado = estadoEfectivo(f);
  return {
    id: f.id,
    estado,
    estado_texto: TEXTO_ESTADO[estado],
    servicio: aServicioVista(f),
    direccion: { distrito: f.distrito, calle: f.calle, numero: f.numero, departamento: f.departamento, referencias: f.referencias },
    inicio: isoConZona(f.inicio, zona),
    fin: isoConZona(f.fin, zona),
    monto: f.monto,
    precio_lista: f.precioLista,
    horas_gratis_aplicadas: Number(f.horasGratisAplicadas),
    requiere_apoyo: f.requiereApoyo,
    expira_en: estado === "pendiente" && f.expiraEn ? isoConZona(f.expiraEn, zona) : null,
    enlace: `/cuenta/reservas/${f.id}`,
  };
}

// Reservas vivas (`reservaActiva`) que todavía no empezaron, de la más cercana a la más lejana.
export async function listarProximas(base: Pick<BaseDatos, "select">, usuarioId: string, config: ConfigPerfil, ahora: Date): Promise<ProximaVista[]> {
  const filas = (await base
    .select(columnasDeVista)
    .from(reservas)
    .where(and(eq(reservas.usuarioId, usuarioId), reservaActiva, gt(reservas.inicio, sql`now()`)))
    .orderBy(asc(reservas.inicio))) as FilaVista[];

  return filas.map((f) => {
    const permitido = dentroDelPlazo(config, ahora, f.inicio);
    return { ...aReservaVista(f, config.horario_atencion.zona), puede_reprogramar: permitido, puede_cancelar: permitido };
  });
}

// Elemento del historial: la reserva más el estado de su reseña (`null` si no la tiene; ítem 18). Solo agrega un campo.
export type HistorialVista = ReservaVista & { resena_estado: "pendiente" | "aprobada" | "rechazada" | null; total_fotos: number };

// Las demás reservas del cliente, de la más reciente a la más antigua, máximo 50. La reseña va en la misma consulta (LEFT JOIN
// por `reserva_id`), que ya está filtrada por `reservas.usuario_id`: no hay forma de traer la reseña de otro cliente.
export async function listarHistorial(base: Pick<BaseDatos, "select">, usuarioId: string, config: Pick<Configuracion, "horario_atencion">): Promise<HistorialVista[]> {
  const filas = (await base
    // `totalFotos` (ítem 17): conteo, en la misma consulta y sin traer filas de fotos, de las fotos de cada reserva de este cliente.
    .select({ ...columnasDeVista, resenaEstado: resenas.estado, totalFotos: sql<number>`(select count(*)::int from ${fotosServicio} where ${fotosServicio.reservaId} = ${reservas.id})` })
    .from(reservas)
    .leftJoin(resenas, eq(resenas.reservaId, reservas.id))
    .where(and(eq(reservas.usuarioId, usuarioId), not(and(reservaActiva, gt(reservas.inicio, sql`now()`))!)))
    .orderBy(desc(reservas.inicio))
    .limit(LIMITE_HISTORIAL)) as (FilaVista & { resenaEstado?: HistorialVista["resena_estado"]; totalFotos?: number | string })[];
  return filas.slice(0, LIMITE_HISTORIAL).map((f) => ({ ...aReservaVista(f, config.horario_atencion.zona), resena_estado: f.resenaEstado ?? null, total_fotos: Number(f.totalFotos ?? 0) }));
}
