import { MENSAJE_SUBIDA } from "@/lib/imagenes/cliente";
import { leerError, MENSAJE_SIN_CONEXION, type Fetch } from "@/lib/reservas/asistente/api-cliente";
import { subirComprobante } from "@/lib/reservas/asistente/comprobante";
import type { Metodo } from "@/lib/reservas/asistente/estado";
import { TEXTO_PLAZO_VENCIDO } from "./avisos";

// Lógica del navegador para subir otro comprobante tras un rechazo (perfil-reservas-y-membresia, decisión 10). No decide
// nada: el servidor (`POST /api/pagos`, ítem 11) valida el plazo, el pago y el comprobante. Aquí solo se valida el archivo
// ANTES de subir, se sube a la tienda privada y se llama a la API con `pago_id`, `metodo` y la ruta. Nunca se envía un monto.

export const MENSAJE_FALLA_SUBIDA = "No pudimos subir tu imagen. Revisa tu conexión e inténtalo de nuevo.";

export type ResultadoDeReenvio =
  | { tipo: "ok" }
  // El plazo venció entre que se abrió la pantalla y se confirmó: se reemplaza el formulario por empezar de nuevo.
  | { tipo: "plazo_vencido"; mensaje: string }
  // 409: ya hay un comprobante en revisión (u otro conflicto).
  | { tipo: "en_espera"; mensaje: string }
  | { tipo: "no_encontrado"; mensaje: string }
  | { tipo: "error"; mensaje: string };

export type Candado = { enCurso: Promise<ResultadoDeReenvio> | null };

export type DependenciasDeReenvio = {
  subir: Parameters<typeof subirComprobante>[2];
  pedir: Fetch;
  candado: Candado;
};

export type EntradaDeReenvio = { pagoId: string; metodo: Metodo | null; archivo: File | null; usuarioId: string };

// Candado contra el doble clic: mientras hay un envío en curso, otra llamada recibe la misma promesa.
export function reenviarDesdeElPerfil(entrada: EntradaDeReenvio, dependencias: DependenciasDeReenvio): Promise<ResultadoDeReenvio> {
  const { candado } = dependencias;
  if (candado.enCurso) return candado.enCurso;
  const trabajo = ejecutar(entrada, dependencias).finally(() => {
    candado.enCurso = null;
  });
  candado.enCurso = trabajo;
  return trabajo;
}

async function ejecutar({ pagoId, metodo, archivo, usuarioId }: EntradaDeReenvio, { subir, pedir }: DependenciasDeReenvio): Promise<ResultadoDeReenvio> {
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
    respuesta = await pedir("/api/pagos", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ pago_id: pagoId, metodo, comprobante: subida.ruta }),
    });
  } catch {
    return { tipo: "error", mensaje: MENSAJE_SIN_CONEXION };
  }

  if (respuesta.status === 201) return { tipo: "ok" };
  const { codigo, mensaje } = await leerError(respuesta);
  if (respuesta.status === 409 && codigo === "plazo_vencido") return { tipo: "plazo_vencido", mensaje: mensaje || TEXTO_PLAZO_VENCIDO };
  if (respuesta.status === 409) return { tipo: "en_espera", mensaje };
  if (respuesta.status === 404) return { tipo: "no_encontrado", mensaje };
  return { tipo: "error", mensaje };
}
