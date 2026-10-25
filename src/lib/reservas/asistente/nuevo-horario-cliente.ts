import type { Disponibilidad } from "@/lib/agenda/disponibilidad";
import type { RespuestaNuevoHorario } from "../nuevo-horario";
import type { DatosNuevoHorario } from "../nuevo-horario-datos";
import { leerError, MENSAJE_SIN_CONEXION, pedir, type Fetch } from "./api-cliente";

// Llamadas del navegador a `/api/pagos/[id]/nuevo-horario`. Reciben `fetch` para probarlas sin red. No calculan nada: el
// servidor decide el servicio, la dirección, el monto y las fechas; el cliente solo elige el día y la hora.

const base = (pagoId: string) => `/api/pagos/${encodeURIComponent(pagoId)}/nuevo-horario`;

export function pedirNuevoHorario(pagoId: string, pedido: Fetch): Promise<DatosNuevoHorario> {
  return pedir<DatosNuevoHorario>(base(pagoId), pedido);
}

export function pedirDisponibilidadNuevoHorario(pagoId: string, fecha: string, pedido: Fetch): Promise<Disponibilidad> {
  return pedir<Disponibilidad>(`${base(pagoId)}/disponibilidad?${new URLSearchParams({ fecha })}`, pedido);
}

export type ResultadoNuevoHorario =
  | { tipo: "ok"; respuesta: RespuestaNuevoHorario }
  // 409 `conflicto`: se agotó el cupo; vuelve a la lista de horarios y el pago sigue intacto.
  | { tipo: "sin_cupo"; mensaje: string }
  // 409 `pago_en_credito`: lo pagado de una cancelación del cliente va a crédito; no se reintenta.
  | { tipo: "en_credito"; mensaje: string }
  | { tipo: "error"; mensaje: string };

// Candado contra el doble envío: mientras hay una confirmación en curso, otra llamada recibe la misma promesa.
export type CandadoNuevoHorario = { enCurso: Promise<ResultadoNuevoHorario> | null };

export function confirmarNuevoHorario(
  entrada: { pagoId: string; inicio: string },
  dependencias: { pedir: Fetch; candado: CandadoNuevoHorario },
): Promise<ResultadoNuevoHorario> {
  const { candado } = dependencias;
  if (candado.enCurso) return candado.enCurso;
  const trabajo = ejecutar(entrada, dependencias.pedir).finally(() => {
    candado.enCurso = null;
  });
  candado.enCurso = trabajo;
  return trabajo;
}

async function ejecutar({ pagoId, inicio }: { pagoId: string; inicio: string }, pedido: Fetch): Promise<ResultadoNuevoHorario> {
  let respuesta: Response;
  try {
    respuesta = await pedido(base(pagoId), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      // Solo el inicio: el pago ya está hecho y el servidor copia el resto de la reserva original.
      body: JSON.stringify({ inicio }),
    });
  } catch {
    return { tipo: "error", mensaje: MENSAJE_SIN_CONEXION };
  }
  if (respuesta.status === 201) return { tipo: "ok", respuesta: (await respuesta.json()) as RespuestaNuevoHorario };
  const { codigo, mensaje } = await leerError(respuesta);
  if (respuesta.status === 409 && codigo === "conflicto") return { tipo: "sin_cupo", mensaje };
  if (respuesta.status === 409 && codigo === "pago_en_credito") return { tipo: "en_credito", mensaje };
  return { tipo: "error", mensaje };
}
