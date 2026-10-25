import type { Disponibilidad } from "@/lib/agenda/disponibilidad";
import type { Cotizacion } from "../cotizar";
import type { ServicioElegido } from "./estado";

// Llamadas del navegador a la API. Reciben `fetch` para probarlas sin red. No calculan nada: devuelven lo del servidor.

export type Fetch = (entrada: string, inicio?: RequestInit) => Promise<Response>;

export const MENSAJE_SIN_CONEXION = "No pudimos conectar con Tiza. Revisa tu internet e inténtalo de nuevo.";
const MENSAJE_GENERICO = "Algo salió mal. Inténtalo de nuevo.";

// Error pensado para mostrarse tal cual al cliente.
export class ErrorDeApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

// El formato único de errores es `{ error: { codigo, mensaje } }` (ADR 0003).
export async function leerError(respuesta: Response): Promise<{ codigo: string; mensaje: string }> {
  try {
    const cuerpo = (await respuesta.json()) as { error?: { codigo?: unknown; mensaje?: unknown } };
    const mensaje = typeof cuerpo.error?.mensaje === "string" && cuerpo.error.mensaje ? cuerpo.error.mensaje : MENSAJE_GENERICO;
    return { codigo: typeof cuerpo.error?.codigo === "string" ? cuerpo.error.codigo : "error", mensaje };
  } catch {
    return { codigo: "error", mensaje: MENSAJE_GENERICO };
  }
}

export function parametrosDeServicio(servicio: ServicioElegido): URLSearchParams {
  const consulta = new URLSearchParams({ tipo: servicio.tipo });
  if (servicio.tipo === "paquete") consulta.set("horas", String(servicio.horas));
  else {
    consulta.set("dormitorios", String(servicio.dormitorios));
    consulta.set("banos", String(servicio.banos));
  }
  return consulta;
}

export async function pedir<T>(url: string, pedido: Fetch): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await pedido(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new ErrorDeApi(0, "sin_conexion", MENSAJE_SIN_CONEXION);
  }
  if (!respuesta.ok) {
    const { codigo, mensaje } = await leerError(respuesta);
    throw new ErrorDeApi(respuesta.status, codigo, mensaje);
  }
  return (await respuesta.json()) as T;
}

// Con la dirección escrita el servidor decide también por el hogar (¿ya recibió la limpieza gratis?). Las referencias
// no intervienen. Sin dirección cotiza solo con la regla del cliente.
export function pedirCotizacion(
  servicio: ServicioElegido,
  pedido: Fetch,
  direccion?: { distrito: string; calle: string; numero: string; departamento: string },
): Promise<Cotizacion> {
  const consulta = parametrosDeServicio(servicio);
  if (direccion) {
    consulta.set("distrito", direccion.distrito.trim());
    consulta.set("calle", direccion.calle.trim());
    consulta.set("numero", direccion.numero.trim());
    if (direccion.departamento.trim()) consulta.set("departamento", direccion.departamento.trim());
  }
  return pedir<Cotizacion>(`/api/cotizacion?${consulta}`, pedido);
}

export function pedirDisponibilidad(servicio: ServicioElegido, fecha: string, pedido: Fetch): Promise<Disponibilidad> {
  const consulta = parametrosDeServicio(servicio);
  consulta.set("fecha", fecha);
  return pedir<Disponibilidad>(`/api/disponibilidad?${consulta}`, pedido);
}
