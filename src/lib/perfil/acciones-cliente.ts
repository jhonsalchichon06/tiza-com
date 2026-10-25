import type { Disponibilidad } from "@/lib/agenda/disponibilidad";
import { MENSAJE_SIN_CONEXION, type Fetch } from "@/lib/reservas/asistente/api-cliente";
import { mensajesDeCancelacion } from "../creditos/textos";

// Lógica del navegador para cancelar y reprogramar desde el detalle de una reserva. No decide nada: el servidor valida el
// plazo, el horario y el cupo. Aquí solo se llama a la API, se evita el doble envío y se traducen las respuestas.

const MENSAJE_GENERICO = "Algo salió mal. Inténtalo de nuevo.";

export type Candado<T> = { enCurso: Promise<T> | null };

// Mientras hay una operación en curso, otra llamada recibe la misma promesa (doble clic).
function conCandado<T>(candado: Candado<T>, trabajo: () => Promise<T>): Promise<T> {
  if (candado.enCurso) return candado.enCurso;
  const p = trabajo().finally(() => {
    candado.enCurso = null;
  });
  candado.enCurso = p;
  return p;
}

type ErrorLeido = { codigo: string; mensaje: string; whatsapp: string | null };

async function leerErrorCompleto(respuesta: Response): Promise<ErrorLeido> {
  try {
    const cuerpo = (await respuesta.json()) as { error?: { codigo?: unknown; mensaje?: unknown; whatsapp?: unknown } };
    return {
      codigo: typeof cuerpo.error?.codigo === "string" ? cuerpo.error.codigo : "error",
      mensaje: typeof cuerpo.error?.mensaje === "string" && cuerpo.error.mensaje ? cuerpo.error.mensaje : MENSAJE_GENERICO,
      whatsapp: typeof cuerpo.error?.whatsapp === "string" ? cuerpo.error.whatsapp : null,
    };
  } catch {
    return { codigo: "error", mensaje: MENSAJE_GENERICO, whatsapp: null };
  }
}

// ---- Cancelar ----

export type ResultadoDeCancelar =
  | { tipo: "ok"; limpiezaGratisConservada: boolean; mensajeCredito: string | null }
  | { tipo: "fuera_de_plazo"; mensaje: string; whatsapp: string | null }
  | { tipo: "error"; mensaje: string };

type RespuestaCancelar = {
  limpieza_gratis_conservada: boolean;
  horas_pagadas: number;
  pago: { estado: string } | null;
  credito?: { generado_horas: number; vence_en: string | null; devuelto_horas: number } | null;
};

// `zona` es la de `horario_atencion` (la pantalla la recibe del servidor): da formato a la fecha de vencimiento del crédito.
export function cancelarDesdeElPerfil(
  reservaId: string,
  { pedir, candado, zona = "America/Lima" }: { pedir: Fetch; candado: Candado<ResultadoDeCancelar>; zona?: string },
): Promise<ResultadoDeCancelar> {
  return conCandado(candado, async () => {
    let respuesta: Response;
    try {
      respuesta = await pedir(`/api/reservas/${reservaId}/cancelar`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "{}" });
    } catch {
      return { tipo: "error", mensaje: MENSAJE_SIN_CONEXION };
    }
    if (respuesta.ok) {
      const cuerpo = (await respuesta.json()) as RespuestaCancelar;
      return {
        tipo: "ok",
        limpiezaGratisConservada: cuerpo.limpieza_gratis_conservada,
        mensajeCredito:
          mensajesDeCancelacion({
            credito: cuerpo.credito,
            horasPagadas: cuerpo.horas_pagadas,
            estadoPago: (cuerpo.pago?.estado ?? null) as "pendiente" | "aprobado" | "rechazado" | null,
            zona,
          }).join(" ") || null,
      };
    }
    const error = await leerErrorCompleto(respuesta);
    if (respuesta.status === 409 && error.codigo === "fuera_de_plazo") return { tipo: "fuera_de_plazo", mensaje: error.mensaje, whatsapp: error.whatsapp };
    return { tipo: "error", mensaje: error.mensaje };
  });
}

// ---- Horarios para reprogramar ----

export type ResultadoDeHorarios = { tipo: "ok"; disponibilidad: Disponibilidad } | { tipo: "error"; mensaje: string };

export async function pedirHorariosDeReserva(reservaId: string, fecha: string, pedir: Fetch): Promise<ResultadoDeHorarios> {
  let respuesta: Response;
  try {
    respuesta = await pedir(`/api/reservas/${reservaId}/disponibilidad?fecha=${encodeURIComponent(fecha)}`, { headers: { Accept: "application/json" } });
  } catch {
    return { tipo: "error", mensaje: MENSAJE_SIN_CONEXION };
  }
  if (!respuesta.ok) return { tipo: "error", mensaje: (await leerErrorCompleto(respuesta)).mensaje };
  return { tipo: "ok", disponibilidad: (await respuesta.json()) as Disponibilidad };
}

// ---- Reprogramar ----

export type ResultadoDeReprogramar =
  | { tipo: "ok"; inicio: string; fin: string; pendiente: boolean }
  // 409 `conflicto`: otro cliente tomó el cupo; se vuelve a pedir otra hora.
  | { tipo: "sin_cupo"; mensaje: string }
  | { tipo: "fuera_de_plazo"; mensaje: string; whatsapp: string | null }
  // 422 y demás: se muestra el mensaje del servidor.
  | { tipo: "error"; mensaje: string };

type RespuestaReprogramar = { reserva: { inicio: string; fin: string; estado: string } };

export function reprogramarDesdeElPerfil(
  reservaId: string,
  inicio: string,
  { pedir, candado }: { pedir: Fetch; candado: Candado<ResultadoDeReprogramar> },
): Promise<ResultadoDeReprogramar> {
  return conCandado(candado, async () => {
    let respuesta: Response;
    try {
      respuesta = await pedir(`/api/reservas/${reservaId}/reprogramar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ inicio }),
      });
    } catch {
      return { tipo: "error", mensaje: MENSAJE_SIN_CONEXION };
    }
    if (respuesta.ok) {
      const { reserva } = (await respuesta.json()) as RespuestaReprogramar;
      return { tipo: "ok", inicio: reserva.inicio, fin: reserva.fin, pendiente: reserva.estado === "pendiente" };
    }
    const error = await leerErrorCompleto(respuesta);
    if (respuesta.status === 409 && error.codigo === "fuera_de_plazo") return { tipo: "fuera_de_plazo", mensaje: error.mensaje, whatsapp: error.whatsapp };
    if (respuesta.status === 409) return { tipo: "sin_cupo", mensaje: error.mensaje };
    return { tipo: "error", mensaje: error.mensaje };
  });
}
