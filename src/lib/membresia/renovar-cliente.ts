import { MENSAJE_SUBIDA } from "@/lib/imagenes/cliente";
import { leerError, MENSAJE_SIN_CONEXION, type Fetch } from "@/lib/reservas/asistente/api-cliente";
import { subirComprobante } from "@/lib/reservas/asistente/comprobante";
import type { Metodo } from "@/lib/reservas/asistente/estado";

// Lógica del navegador para pagar la renovación (renovacion-del-mes-4, decisión 8). No decide nada: el servidor
// (`POST /api/membresia/renovar`) valida la vigencia, el comprobante y fija el monto. Aquí solo se valida el archivo ANTES
// de subir, se sube a la tienda privada y se llama a la API con el método y la ruta. Nunca se envía un monto.

export const MENSAJE_FALLA_SUBIDA = "No pudimos subir tu imagen. Revisa tu conexión e inténtalo de nuevo.";

export type ResultadoDeRenovacion =
  | { tipo: "ok" }
  // 409: no se puede renovar ahora (vigente, ya en revisión o rechazada con plazo). El mensaje del servidor explica por qué.
  | { tipo: "no_aplica"; mensaje: string }
  | { tipo: "error"; mensaje: string };

export type Candado = { enCurso: Promise<ResultadoDeRenovacion> | null };

export type DependenciasDeRenovacion = {
  subir: Parameters<typeof subirComprobante>[2];
  pedir: Fetch;
  candado: Candado;
};

export type EntradaDeRenovacion = { metodo: Metodo | null; archivo: File | null; usuarioId: string };

// Candado contra el doble clic: mientras hay un envío en curso, otra llamada recibe la misma promesa.
export function renovarDesdeElPerfil(entrada: EntradaDeRenovacion, dependencias: DependenciasDeRenovacion): Promise<ResultadoDeRenovacion> {
  const { candado } = dependencias;
  if (candado.enCurso) return candado.enCurso;
  const trabajo = ejecutar(entrada, dependencias).finally(() => {
    candado.enCurso = null;
  });
  candado.enCurso = trabajo;
  return trabajo;
}

async function ejecutar({ metodo, archivo, usuarioId }: EntradaDeRenovacion, { subir, pedir }: DependenciasDeRenovacion): Promise<ResultadoDeRenovacion> {
  if (!metodo) return { tipo: "error", mensaje: "Elige cómo vas a pagar: Yape o transferencia." };
  if (!archivo) return { tipo: "error", mensaje: "Sube el comprobante de tu pago para continuar." };

  // Valida (tipo y 5 MB) y sube. Si falla, no se llama a la API: no se crea ningún pago.
  const subida = await subirComprobante(archivo, usuarioId, subir);
  if (!subida.ok) {
    const esDeRed = subida.mensaje === MENSAJE_SUBIDA || subida.mensaje === MENSAJE_SIN_CONEXION;
    return { tipo: "error", mensaje: esDeRed ? MENSAJE_FALLA_SUBIDA : subida.mensaje };
  }

  let respuesta: Response;
  try {
    respuesta = await pedir("/api/membresia/renovar", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ metodo, comprobante: subida.ruta }),
    });
  } catch {
    return { tipo: "error", mensaje: MENSAJE_SIN_CONEXION };
  }

  if (respuesta.status === 201) return { tipo: "ok" };
  const { mensaje } = await leerError(respuesta);
  return respuesta.status === 409 ? { tipo: "no_aplica", mensaje } : { tipo: "error", mensaje };
}
