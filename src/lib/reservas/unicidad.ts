import { ErrorApi } from "../errores";

export const MENSAJE_PAGO_EN_REVISION = "Tu pago de la membresía ya está en revisión.";
export const MENSAJE_RESERVA_EN_ESPERA = "Ya tienes una reserva esperando la aprobación de tu pago.";
export const MENSAJE_PAGO_YA_USADO = "Ese pago ya tiene una reserva asociada.";
export const MENSAJE_PAGO_YA_REEMPLAZADO = "Ya subiste otro comprobante para ese pago. Espera a que lo revisemos.";

export const MENSAJE_GRATIS_DEL_HOGAR_USADA = "Otra cuenta ya recibió la limpieza gratis de esta dirección. Revisa el precio actualizado y confirma de nuevo.";
export const MENSAJE_GRATIS_DEL_CLIENTE_USADA = "Ya tienes una limpieza gratis reservada o realizada.";

const POR_INDICE: Record<string, { codigo: string; mensaje: string }> = {
  membresias_una_pendiente_por_cliente: { codigo: "en_espera", mensaje: MENSAJE_PAGO_EN_REVISION },
  reservas_una_pendiente_por_cliente: { codigo: "en_espera", mensaje: MENSAJE_RESERVA_EN_ESPERA },
  reservas_un_pago_por_reserva_viva: { codigo: "en_espera", mensaje: MENSAJE_PAGO_YA_USADO },
  // Dos reenvíos simultáneos del mismo pago rechazado: gana uno y el otro recibe este 409.
  pagos_un_reemplazo_por_pago: { codigo: "en_espera", mensaje: MENSAJE_PAGO_YA_REEMPLAZADO },
  reservas_primera_gratis_por_hogar: { codigo: "limpieza_gratis_usada", mensaje: MENSAJE_GRATIS_DEL_HOGAR_USADA },
  reservas_primera_gratis_por_cliente: { codigo: "limpieza_gratis_usada", mensaje: MENSAJE_GRATIS_DEL_CLIENTE_USADA },
};

// Dos peticiones del mismo cliente que pasan ambas las comprobaciones chocan en un índice único (23505).
// Drizzle deja el error de la base en `cause`. Se traduce solo lo conocido, con el código `en_espera` (distinto del
// `conflicto` de la falta de cupo) o, para los índices de la limpieza gratis, `limpieza_gratis_usada`; cualquier otro error, incluido otro 23505, se devuelve tal cual.
export function traducirUnicidad(error: unknown): unknown {
  const causa = typeof error === "object" && error !== null ? (error as { cause?: unknown }).cause : undefined;
  if (typeof causa !== "object" || causa === null) return error;
  const { code, constraint } = causa as { code?: unknown; constraint?: unknown };
  if (code !== "23505" || typeof constraint !== "string") return error;
  const traduccion = POR_INDICE[constraint];
  return traduccion ? new ErrorApi(409, traduccion.codigo, traduccion.mensaje) : error;
}
