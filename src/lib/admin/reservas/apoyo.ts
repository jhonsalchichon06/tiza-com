import { asc, and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/cliente";
import { reservaActiva } from "@/db/reservas-activas";
import { reservas, usuarios } from "@/db/esquema";
import { transaccionDeEscritura, type BaseDatos } from "../../agenda/expirar";
import { isoConZona } from "../../agenda/horario";
import type { Configuracion } from "../../configuracion";
import { ErrorApi } from "../../errores";
import { esUuid } from "../../uuid";
import { validar } from "../../validacion-sesion";
import { MENSAJE_RESERVA_NO_ENCONTRADA } from "./completar";
import { esViva, NOMBRE_DEL_ESTADO } from "./estado";

// Apoyo por coordinar (PRD, alcance 4 y 9; ADR 0008). La persona de apoyo NO es parte del equipo y no ocupa cupo: el sistema
// solo marca la reserva («requiere apoyo») y recuerda al administrador que la coordine por su cuenta.

// Tope de la nota (texto libre que escribe el administrador). Sin CHECK en la base: no abre una migración por un campo de
// uso interno (design de gestion-de-reservas-y-apoyo, decisión 6).
export const LARGO_MAXIMO_DE_NOTA = 500;
export const MENSAJE_NOTA_LARGA = `La nota puede tener hasta ${LARGO_MAXIMO_DE_NOTA} caracteres.`;
export const MENSAJE_SIN_APOYO = "Esta reserva no requiere apoyo.";

type ConfigApoyo = Pick<Configuracion, "horario_atencion">;
type Lector = Pick<BaseDatos, "select">;

export type ElementoDeApoyo = {
  id: string;
  estado: "confirmada" | "pendiente";
  cliente: { id: string; nombre: string; correo: string; celular: string };
  direccion: { distrito: string; calle: string; numero: string; departamento: string | null; referencias: string | null };
  inicio: string;
  fin: string;
  horas_trabajo: number;
  horas_agenda: number;
  apoyo_nota: string | null;
  // Días de calendario (en la zona de atención) que faltan para el servicio; calculados con el reloj de la base.
  dias_restantes: number;
  pago_id: string;
  // Viva y con el servicio por empezar: ofrece «Reprogramar» (la salida si no se consigue al apoyo; ver reprogramar.ts).
  puede_reprogramar: boolean;
};

// Reservas vivas (`confirmada` o `pendiente` vigente) que requieren apoyo y siguen `por_coordinar`, de la más próxima a la
// más lejana. Una `pendiente` vigente se incluye (con su estado a la vista) para que el administrador empiece a buscar a la
// persona sin esperar; si el pago no se aprueba y la reserva expira, sale sola de la lista (`reservaActiva` ya la ignora).
export async function listarApoyoPorCoordinar(base: Lector, config: ConfigApoyo): Promise<ElementoDeApoyo[]> {
  const zona = config.horario_atencion.zona;
  const filas = await base
    .select({
      id: reservas.id,
      estado: reservas.estado,
      distrito: reservas.distrito,
      calle: reservas.calle,
      numero: reservas.numero,
      departamento: reservas.departamento,
      referencias: reservas.referencias,
      inicio: reservas.inicio,
      fin: reservas.fin,
      horasTrabajo: reservas.horasTrabajo,
      horasAgenda: reservas.horasAgenda,
      apoyoNota: reservas.apoyoNota,
      pagoId: reservas.pagoId,
      clienteId: usuarios.id,
      clienteNombre: usuarios.name,
      clienteCorreo: usuarios.email,
      clienteCelular: usuarios.telefono,
      yaEmpezo: sql<boolean>`(${reservas.inicio} <= now())`,
      diasRestantes: sql<number>`((${reservas.inicio} AT TIME ZONE ${zona})::date - (now() AT TIME ZONE ${zona})::date)`,
    })
    .from(reservas)
    .innerJoin(usuarios, eq(usuarios.id, reservas.usuarioId))
    .where(and(eq(reservas.requiereApoyo, true), eq(reservas.apoyoEstado, "por_coordinar"), reservaActiva))
    .orderBy(asc(reservas.inicio));

  return filas.map((f) => ({
    id: f.id,
    estado: f.estado === "pendiente" ? "pendiente" : "confirmada",
    cliente: { id: f.clienteId, nombre: f.clienteNombre, correo: f.clienteCorreo, celular: f.clienteCelular },
    direccion: { distrito: f.distrito, calle: f.calle, numero: f.numero, departamento: f.departamento, referencias: f.referencias },
    inicio: isoConZona(f.inicio, zona),
    fin: isoConZona(f.fin, zona),
    horas_trabajo: Number(f.horasTrabajo),
    horas_agenda: Number(f.horasAgenda),
    apoyo_nota: f.apoyoNota,
    dias_restantes: Number(f.diasRestantes),
    pago_id: f.pagoId,
    puede_reprogramar: !f.yaEmpezo,
  }));
}

export const esquemaMarcarApoyo = z.object({
  nota: z
    .string({ error: "La nota debe ser un texto." })
    .trim()
    .max(LARGO_MAXIMO_DE_NOTA, { error: MENSAJE_NOTA_LARGA })
    .optional(),
});

export type DependenciasApoyo = { base: () => Pick<BaseDatos, "transaction"> };
const porDefecto: DependenciasApoyo = { base: () => db() };

export type RespuestaMarcarApoyo = { reserva: { id: string; apoyo_estado: "coordinado"; apoyo_nota: string | null } };

// Marca el apoyo como coordinado y guarda la nota (opcional, recortada, hasta 500 caracteres). Repetirla sobre una reserva
// ya `coordinado` es válido y solo reescribe la nota (corregir un teléfono mal escrito). No toca equipo, horario, precio ni
// estado de la reserva. La fila se bloquea para no pisar a otro administrador.
export async function marcarApoyoCoordinado(
  { reservaId, cuerpo }: { reservaId: string; cuerpo: unknown },
  dependencias: DependenciasApoyo = porDefecto,
): Promise<RespuestaMarcarApoyo> {
  const datos = validar(esquemaMarcarApoyo, cuerpo ?? {});
  if (!esUuid(reservaId)) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
  const nota = datos.nota ? datos.nota : null;

  return transaccionDeEscritura(async (tx) => {
    const [reserva] = await tx
      .select({ id: reservas.id, estado: reservas.estado, requiereApoyo: reservas.requiereApoyo })
      .from(reservas)
      .where(eq(reservas.id, reservaId))
      .for("update");
    if (!reserva) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
    if (!reserva.requiereApoyo) throw ErrorApi.conflicto(MENSAJE_SIN_APOYO);
    // Las vencidas ya se marcaron al abrir la transacción: una `pendiente` vencida llega como `expirada`.
    if (!esViva(reserva.estado)) throw ErrorApi.conflicto(`Esa reserva está ${NOMBRE_DEL_ESTADO[reserva.estado]}, así que ya no necesita apoyo.`);

    const [marcada] = await tx
      .update(reservas)
      .set({ apoyoEstado: "coordinado", apoyoNota: nota })
      .where(eq(reservas.id, reserva.id))
      .returning({ id: reservas.id, apoyoNota: reservas.apoyoNota });
    return { reserva: { id: marcada.id, apoyo_estado: "coordinado" as const, apoyo_nota: marcada.apoyoNota } };
  }, dependencias.base());
}
