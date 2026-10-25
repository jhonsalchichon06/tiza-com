import { horaLocal } from "../agenda/horario";

// Enlace de WhatsApp con el mensaje de la reserva ya escrito. Solo es un enlace: el sistema no envía nada (PRD, "No alcance").

// Número con código de país y solo dígitos (por ejemplo, Perú: 51 + 9 dígitos). Devuelve null si falta o no es válido.
export function enlaceWhatsapp({ numero, mensaje }: { numero: string | null | undefined; mensaje: string }): string | null {
  if (!numero || !/^\d{8,15}$/.test(numero)) return null;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
}

export type ServicioParaMensaje =
  | { tipo: "estandar" | "profunda" | "mudanza" }
  | { tipo: "paquete"; horas: number };

const NOMBRES: Record<"estandar" | "profunda" | "mudanza", string> = {
  estandar: "Limpieza estándar",
  profunda: "Limpieza profunda",
  mudanza: "Limpieza de mudanza",
};

export function describirServicio(servicio: ServicioParaMensaje): string {
  return servicio.tipo === "paquete" ? `Paquete de ${servicio.horas} horas` : NOMBRES[servicio.tipo];
}

export type EstadoParaMensaje = "pendiente" | "confirmada";

// Nombre y celular del cliente, servicio, día y hora de Lima, dirección y estado. Sin montos.
export function mensajeDeReserva(datos: {
  estado: EstadoParaMensaje;
  nombre: string;
  celular: string;
  servicio: ServicioParaMensaje;
  inicio: Date;
  zona: string;
  distrito: string;
  calle: string;
  numero: string;
  departamento: string | null;
}): string {
  const dia = new Intl.DateTimeFormat("es-PE", {
    timeZone: datos.zona,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(datos.inicio);
  const direccion = [`${datos.calle} ${datos.numero}`, datos.departamento, datos.distrito].filter(Boolean).join(", ");
  return [
    `Hola, soy ${datos.nombre} (celular ${datos.celular}). Acabo de reservar en Tiza.`,
    `Servicio: ${describirServicio(datos.servicio)}`,
    `Día y hora: ${dia}, ${horaLocal(datos.inicio, datos.zona)} (hora de Lima)`,
    `Dirección: ${direccion}`,
    datos.estado === "confirmada" ? "Estado: confirmada." : "Estado: en espera de la aprobación de mi pago.",
  ].join("\n");
}

// Mensaje para quien ya no puede cancelar o cambiar su reserva desde el perfil por estar a menos de 24 horas (perfil-reservas-y-membresia).
// Solo coordina por WhatsApp: el sistema no envía nada.
export function mensajeDeCambioUrgente(datos: {
  nombre: string;
  celular: string;
  accion: "cancelar" | "cambiar";
  servicio: ServicioParaMensaje;
  inicio: Date;
  zona: string;
  distrito: string;
  calle: string;
  numero: string;
  departamento: string | null;
}): string {
  const dia = new Intl.DateTimeFormat("es-PE", { timeZone: datos.zona, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(datos.inicio);
  const direccion = [`${datos.calle} ${datos.numero}`, datos.departamento, datos.distrito].filter(Boolean).join(", ");
  return [
    `Hola, soy ${datos.nombre} (celular ${datos.celular}). Necesito ${datos.accion === "cancelar" ? "cancelar" : "cambiar el horario de"} mi reserva en Tiza.`,
    `Servicio: ${describirServicio(datos.servicio)}`,
    `Día y hora: ${dia}, ${horaLocal(datos.inicio, datos.zona)} (hora de Lima)`,
    `Dirección: ${direccion}`,
  ].join("\n");
}
