import { and, asc, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { reservaActiva } from "@/db/reservas-activas";
import { equipos, reservas, usuarios } from "@/db/esquema";
import type { BaseDatos } from "../../agenda/expirar";
import { isoConZona } from "../../agenda/horario";
import type { Configuracion } from "../../configuracion";
import { validar } from "../../validacion-sesion";
import { esViva, estadoEfectivoSql, FILTROS_DE_ESTADO, type EstadoEfectivo, type FiltroDeEstado } from "./estado";

// Tope técnico de filas (no es una regla de negocio): con 100 ordenadas por `inicio` basta para el volumen esperado.
export const LIMITE_DE_LISTA = 100;
export const MENSAJE_ESTADO_INVALIDO = `El estado debe ser uno de: ${FILTROS_DE_ESTADO.join(", ")}.`;

const esquemaFiltro = z.enum(FILTROS_DE_ESTADO, { error: MENSAJE_ESTADO_INVALIDO });

type ConfigListado = Pick<Configuracion, "horario_atencion">;
type Lector = Pick<BaseDatos, "select">;

export type EquipoActivo = { id: number; nombre: string };

export type ElementoDeReserva = {
  id: string;
  estado: EstadoEfectivo;
  cliente: { id: string; nombre: string; correo: string; celular: string };
  servicio: { tipo: string; dormitorios: number | null; banos: number | null; horas_trabajo: number };
  direccion: { distrito: string; calle: string; numero: string; departamento: string | null; referencias: string | null };
  inicio: string;
  fin: string;
  fin_bloqueo: string;
  horas_agenda: number;
  expira_en: string | null;
  equipo: { id: number; nombre: string };
  requiere_apoyo: boolean;
  apoyo_estado: "por_coordinar" | "coordinado" | null;
  apoyo_nota: string | null;
  pago_id: string;
  puede_completar: boolean;
  puede_reasignar: boolean;
  // Viva y con el servicio todavía por empezar (ítem 16, reprogramar a nombre del cliente).
  puede_reprogramar: boolean;
  // Quién (administrador) y cuándo reprogramó la reserva a nombre del cliente. Solo lo ve el administrador.
  reprogramada_en: string | null;
  reprogramada_por: { id: string; nombre: string | null } | null;
};

export type RespuestaListado = { reservas: ElementoDeReserva[]; equipos: EquipoActivo[] };

// Condición, orden y dirección de cada filtro. Sin filtro: lo que viene (vivas desde ahora). Los terminados
// (`completada`, `cancelada`, `expirada`) van del más reciente al más antiguo; lo demás, del más próximo al más lejano.
function condicion(filtro: FiltroDeEstado | undefined): { donde: SQL; descendente: boolean } {
  switch (filtro) {
    case undefined:
      return { donde: and(reservaActiva, gte(reservas.inicio, sql`now()`))!, descendente: false };
    case "pendiente":
      return { donde: and(reservaActiva, eq(reservas.estado, "pendiente"))!, descendente: false };
    case "confirmada":
      return { donde: eq(reservas.estado, "confirmada"), descendente: false };
    case "por_completar":
      return { donde: and(eq(reservas.estado, "confirmada"), sql`${reservas.inicio} <= now()`)!, descendente: false };
    case "completada":
      return { donde: eq(reservas.estado, "completada"), descendente: true };
    case "cancelada":
      return { donde: eq(reservas.estado, "cancelada"), descendente: true };
    case "expirada":
      return { donde: sql`${estadoEfectivoSql} = 'expirada'`, descendente: true };
  }
}

// Lista las reservas con su cliente, su equipo y su estado EFECTIVO (una `pendiente` vencida sale `expirada`, nunca
// `pendiente`), más los equipos activos para el selector de reasignar. Todo con el reloj de la base. No devuelve montos ni
// rutas de comprobante: el detalle del pago vive en /admin/pagos/<pago_id>.
export async function listarReservas(base: Lector, { estado }: { estado?: string | null }, config: ConfigListado): Promise<RespuestaListado> {
  const filtro = estado === undefined || estado === null ? undefined : validar(esquemaFiltro, estado);
  const { donde, descendente } = condicion(filtro);
  const zona = config.horario_atencion.zona;
  const reprogramador = alias(usuarios, "reprogramador");

  const filas = await base
    .select({
      id: reservas.id,
      estado: estadoEfectivoSql,
      tipo: reservas.tipo,
      dormitorios: reservas.dormitorios,
      banos: reservas.banos,
      horasTrabajo: reservas.horasTrabajo,
      horasAgenda: reservas.horasAgenda,
      distrito: reservas.distrito,
      calle: reservas.calle,
      numero: reservas.numero,
      departamento: reservas.departamento,
      referencias: reservas.referencias,
      inicio: reservas.inicio,
      fin: reservas.fin,
      finBloqueo: reservas.finBloqueo,
      expiraEn: reservas.expiraEn,
      requiereApoyo: reservas.requiereApoyo,
      apoyoEstado: reservas.apoyoEstado,
      apoyoNota: reservas.apoyoNota,
      pagoId: reservas.pagoId,
      reprogramadaPor: reservas.reprogramadaPor,
      reprogramadaEn: reservas.reprogramadaEn,
      reprogramadorNombre: reprogramador.name,
      equipoId: equipos.id,
      equipoNombre: equipos.nombre,
      clienteId: usuarios.id,
      clienteNombre: usuarios.name,
      clienteCorreo: usuarios.email,
      clienteCelular: usuarios.telefono,
      yaEmpezo: sql<boolean>`(${reservas.inicio} <= now())`,
    })
    .from(reservas)
    .innerJoin(usuarios, eq(usuarios.id, reservas.usuarioId))
    .innerJoin(equipos, eq(equipos.id, reservas.equipoId))
    .leftJoin(reprogramador, eq(reprogramador.id, reservas.reprogramadaPor))
    .where(donde)
    .orderBy(descendente ? desc(reservas.inicio) : asc(reservas.inicio))
    .limit(LIMITE_DE_LISTA);

  const activos = await base.select({ id: equipos.id, nombre: equipos.nombre }).from(equipos).where(eq(equipos.activo, true)).orderBy(asc(equipos.id));

  return {
    reservas: filas.map((f): ElementoDeReserva => {
      const viva = esViva(f.estado);
      return {
        id: f.id,
        estado: f.estado,
        cliente: { id: f.clienteId, nombre: f.clienteNombre, correo: f.clienteCorreo, celular: f.clienteCelular },
        servicio: { tipo: f.tipo, dormitorios: f.dormitorios, banos: f.banos, horas_trabajo: Number(f.horasTrabajo) },
        direccion: { distrito: f.distrito, calle: f.calle, numero: f.numero, departamento: f.departamento, referencias: f.referencias },
        inicio: isoConZona(f.inicio, zona),
        fin: isoConZona(f.fin, zona),
        fin_bloqueo: isoConZona(f.finBloqueo, zona),
        horas_agenda: Number(f.horasAgenda),
        expira_en: f.expiraEn ? isoConZona(f.expiraEn, zona) : null,
        equipo: { id: f.equipoId, nombre: f.equipoNombre },
        requiere_apoyo: f.requiereApoyo,
        apoyo_estado: f.apoyoEstado,
        apoyo_nota: f.apoyoNota,
        pago_id: f.pagoId,
        puede_completar: f.estado === "confirmada" && Boolean(f.yaEmpezo),
        puede_reasignar: viva && activos.some((e) => e.id !== f.equipoId),
        puede_reprogramar: viva && !f.yaEmpezo,
        reprogramada_en: f.reprogramadaEn ? isoConZona(f.reprogramadaEn, zona) : null,
        reprogramada_por: f.reprogramadaPor ? { id: f.reprogramadaPor, nombre: f.reprogramadorNombre ?? null } : null,
      };
    }),
    equipos: activos,
  };
}
