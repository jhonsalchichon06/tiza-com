import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/cliente";
import { pagos, reservas } from "@/db/esquema";
import { calcularDisponibilidad, type Disponibilidad, type EquipoAgenda, type Ocupacion } from "../agenda/disponibilidad";
import type { BaseDatos } from "../agenda/expirar";
import { instanteLocal, isoConZona, validarFecha } from "../agenda/horario";
import { leerOcupacion } from "../agenda/leer";
import { leerConfiguracion, type Configuracion } from "../configuracion";
import { ErrorApi } from "../errores";
import { pagosParaElegirHorario } from "../perfil/nuevo-horario";
import { pagosConHorarioPendiente } from "../pagos/horario-pendiente";
import { esUuid } from "../uuid";
import { fechasDeMiembro } from "./cotizar";
import { leerMembresiaQueAutoriza } from "./membresia-vigente";

// Datos del nuevo horario que elige el cliente cuando el administrador aprobó su pago después de que la reserva expiró
// (PRD, caso borde 8; ADR 0009). El recurso es el PAGO ya aprobado; la reserva nueva lo reutiliza sin otro comprobante.
// Todo es del dueño: la condición `usuario_id` va en la misma consulta que el `id`, así que un pago ajeno (o el de un
// cliente visto por un administrador) responde igual que uno inexistente.

export const MENSAJE_PAGO_NO_ENCONTRADO = "No encontramos ese pago.";
export const MENSAJE_PAGO_EN_CREDITO = "Las horas de esa cancelación pasan a tu crédito. Úsalo en tu próxima reserva.";
export const MENSAJE_SIN_HORARIO_PENDIENTE = "Ese pago no tiene un horario pendiente por elegir.";

type Lector = Pick<BaseDatos, "select">;

export type DependenciasNuevoHorarioDatos = {
  base: () => Lector;
  leerConfig: () => Promise<Configuracion>;
  leerOcupacion: (ventana: { desde: Date; hasta: Date }) => Promise<{ equipos: EquipoAgenda[]; ocupadas: Ocupacion[] }>;
};

export function dependenciasPorDefecto(base: () => Lector = () => db()): DependenciasNuevoHorarioDatos {
  return {
    base,
    leerConfig: () => leerConfiguracion(),
    leerOcupacion: (ventana) => leerOcupacion(base(), ventana),
  };
}

export type PagoDelDueno = { id: string; concepto: "membresia" | "reserva" | "membresia_y_reserva"; monto: number; estado: "pendiente" | "aprobado" | "rechazado" };

// El pago del dueño, o 404 (id sin forma de uuid, inexistente o ajeno: la misma respuesta).
export async function cargarPagoDelDueno(lector: Pick<Lector, "select">, usuarioId: string, pagoId: string): Promise<PagoDelDueno> {
  if (!esUuid(pagoId)) throw ErrorApi.noEncontrado(MENSAJE_PAGO_NO_ENCONTRADO);
  const [pago] = await lector
    .select({ id: pagos.id, concepto: pagos.concepto, monto: pagos.monto, estado: pagos.estado })
    .from(pagos)
    .where(and(eq(pagos.id, pagoId), eq(pagos.usuarioId, usuarioId)))
    .limit(1);
  if (!pago) throw ErrorApi.noEncontrado(MENSAJE_PAGO_NO_ENCONTRADO);
  return pago;
}

// La reserva más reciente de un pago: es la que el nuevo horario copia (servicio, dirección, horas gratis y monto).
export async function reservaOrigenDelPago(lector: Pick<Lector, "select">, pagoId: string) {
  const [reserva] = await lector.select().from(reservas).where(eq(reservas.pagoId, pagoId)).orderBy(desc(reservas.creadaEn)).limit(1);
  return reserva ?? null;
}

// ¿Admite el pago un nuevo horario? Es la regla de `pagosParaElegirHorario` (#12) sin reescribirla; solo se distingue el
// motivo para responder bien: una cancelación del cliente va a crédito (409 pago_en_credito, ADR 0012), cualquier otra
// razón (pendiente, rechazado, ya usado) es un 409 genérico.
export async function comprobarElegible(lector: Lector, usuarioId: string, pago: PagoDelDueno): Promise<void> {
  if (pago.estado !== "aprobado") throw ErrorApi.conflicto(MENSAJE_SIN_HORARIO_PENDIENTE);
  const pendientes = await pagosConHorarioPendiente(lector, usuarioId);
  if (!pendientes.some((p) => p.id === pago.id)) throw ErrorApi.conflicto(MENSAJE_SIN_HORARIO_PENDIENTE);
  const elegibles = await pagosParaElegirHorario(lector, usuarioId, async () => pendientes);
  if (!elegibles.some((p) => p.id === pago.id)) throw new ErrorApi(409, "pago_en_credito", MENSAJE_PAGO_EN_CREDITO);
}

async function cargarElegible(lector: Lector, usuarioId: string, pagoId: string) {
  const pago = await cargarPagoDelDueno(lector, usuarioId, pagoId);
  await comprobarElegible(lector, usuarioId, pago);
  const origen = await reservaOrigenDelPago(lector, pago.id);
  if (!origen) throw ErrorApi.conflicto(MENSAJE_SIN_HORARIO_PENDIENTE);
  return { pago, origen };
}

export type DatosNuevoHorario = {
  pago: { id: string; monto_pagado: number };
  servicio: { tipo: "estandar" | "profunda" | "mudanza"; dormitorios: number; banos: number } | { tipo: "paquete"; horas: number };
  direccion: { distrito: string; calle: string; numero: string; departamento: string | null; referencias: string | null };
  horas_trabajo: number;
  horas_agenda: number;
  horas_gratis_aplicadas: number;
  requiere_apoyo: boolean;
  fechas: { desde: string; hasta: string };
  // Instante exacto (ISO con zona) desde el cual ya no se puede empezar: el fin de la membresía que autoriza.
  limite: string;
  membresia_vigente: boolean;
};

// GET /api/pagos/:id/nuevo-horario
export async function leerNuevoHorario(
  { usuario, pagoId, ahora }: { usuario: { id: string }; pagoId: string; ahora: Date },
  dependencias: DependenciasNuevoHorarioDatos = dependenciasPorDefecto(),
): Promise<DatosNuevoHorario> {
  const lector = dependencias.base();
  const { pago, origen } = await cargarElegible(lector, usuario.id, pagoId);
  const config = await dependencias.leerConfig();
  const membresia = await leerMembresiaQueAutoriza(lector, usuario.id);
  if (!membresia) throw ErrorApi.invalido("Necesitas una membresía vigente para reservar. Renueva tu membresía para seguir reservando.");
  const zona = config.horario_atencion.zona;
  return {
    pago: { id: pago.id, monto_pagado: pago.monto },
    servicio:
      origen.tipo === "paquete"
        ? { tipo: "paquete", horas: Number(origen.horasTrabajo) }
        : { tipo: origen.tipo, dormitorios: origen.dormitorios as number, banos: origen.banos as number },
    direccion: { distrito: origen.distrito, calle: origen.calle, numero: origen.numero, departamento: origen.departamento, referencias: origen.referencias },
    horas_trabajo: Number(origen.horasTrabajo),
    horas_agenda: Number(origen.horasAgenda),
    horas_gratis_aplicadas: Number(origen.horasGratisAplicadas),
    requiere_apoyo: origen.requiereApoyo,
    fechas: fechasDeMiembro(config, ahora, membresia.fin),
    limite: isoConZona(membresia.fin, zona),
    membresia_vigente: membresia.fin.getTime() > ahora.getTime(),
  };
}

// GET /api/pagos/:id/nuevo-horario/disponibilidad?fecha=AAAA-MM-DD. Con las `horas_agenda` GUARDADAS de la reserva original,
// sin parámetros de servicio. La original ya está `expirada` o `cancelada`, así que su hueco ya está libre.
export async function leerDisponibilidadNuevoHorario(
  { usuario, pagoId, fecha, ahora }: { usuario: { id: string }; pagoId: string; fecha: unknown; ahora: Date },
  dependencias: DependenciasNuevoHorarioDatos = dependenciasPorDefecto(),
): Promise<Disponibilidad> {
  const lector = dependencias.base();
  const { origen } = await cargarElegible(lector, usuario.id, pagoId);
  const dia = validarFecha(fecha);
  const config = await dependencias.leerConfig();
  const desde = instanteLocal(dia, "00:00", config.horario_atencion.zona);
  const hasta = new Date(desde.getTime() + 30 * 3_600_000);
  const { equipos, ocupadas } = await dependencias.leerOcupacion({ desde, hasta });
  return calcularDisponibilidad({ config, ahora, fecha: dia, horasAgenda: Number(origen.horasAgenda), equipos, ocupadas });
}
