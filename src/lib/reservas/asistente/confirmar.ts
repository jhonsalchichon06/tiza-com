import type { RespuestaDeReserva } from "../crear";
import { leerError, MENSAJE_SIN_CONEXION, type Fetch } from "./api-cliente";
import { ErrorImagen } from "@/lib/imagenes/cliente";
import { sinCosto, type Estado } from "./estado";
import { construirCuerpo } from "./solicitud";

export type ResultadoDeConfirmar =
  | { tipo: "ok"; respuesta: RespuestaDeReserva }
  // 409 `conflicto`: se agotó el cupo; el cliente elige otra hora y el comprobante ya subido (si hubo) se reutiliza.
  | { tipo: "sin_cupo"; mensaje: string; comprobante: string | null }
  // 409 `en_espera` o `horario_pendiente`: ya hay una reserva, un pago en revisión o un pago aprobado esperando horario; no se
  // reintenta. Con `horario_pendiente` trae el enlace a la cuenta, donde el perfil lleva a elegir el nuevo horario.
  | { tipo: "bloqueado"; mensaje: string; enlace?: string }
  // 422 `comprobante_requerido`: el servidor cobra algo y la cotización que vio el cliente decía que no (cambió la limpieza
  // gratis o el crédito). Se cotiza de nuevo y se vuelve al paso de pago para elegir método y subir el comprobante.
  | { tipo: "recotizar"; mensaje: string }
  // 409 limpieza_gratis_usada: otra cuenta se llevó la gratis de este hogar mientras tanto; hay que ver el precio nuevo.
  | { tipo: "gratis_usada"; mensaje: string }
  | { tipo: "error"; mensaje: string };

// Candado contra el doble envío: mientras hay una confirmación en curso, otra llamada recibe la misma promesa.
export type Candado = { enCurso: Promise<ResultadoDeConfirmar> | null };

export type DependenciasDeConfirmar = {
  subir: (archivo: File) => Promise<string>;
  pedir: Fetch;
  candado: Candado;
};

export type EntradaDeConfirmar = {
  estado: Estado;
  // Solo hace falta si el comprobante todavía no se subió (`estado.comprobante` vacío) y la limpieza tiene costo.
  archivo?: File | null;
};

const MENSAJE_SIN_COMPROBANTE = "Sube el comprobante de tu pago para continuar.";
// A dónde lleva un pago aprobado que espera horario: el perfil muestra «Elige un nuevo día y hora» con el enlace.
export const ENLACE_A_LA_CUENTA = "/cuenta";

// Sube primero la imagen (si hace falta) y solo después envía POST /api/reservas con la ruta (ADR 0010).
// Si la subida falla no se envía nada. Un 409 de cupo devuelve la ruta para no volver a subir.
export function confirmarReserva(entrada: EntradaDeConfirmar, dependencias: DependenciasDeConfirmar): Promise<ResultadoDeConfirmar> {
  const { candado } = dependencias;
  if (candado.enCurso) return candado.enCurso;
  const trabajo = ejecutar(entrada, dependencias).finally(() => {
    candado.enCurso = null;
  });
  candado.enCurso = trabajo;
  return trabajo;
}

async function ejecutar({ estado, archivo }: EntradaDeConfirmar, { subir, pedir }: DependenciasDeConfirmar): Promise<ResultadoDeConfirmar> {
  // Sin costo no hay comprobante: la ruta ni se sube ni se envía.
  let ruta: string | null = sinCosto(estado) ? null : estado.comprobante;
  if (!ruta && !sinCosto(estado)) {
    if (!archivo) return { tipo: "error", mensaje: MENSAJE_SIN_COMPROBANTE };
    try {
      ruta = await subir(archivo);
    } catch (error) {
      return { tipo: "error", mensaje: error instanceof ErrorImagen ? error.message : MENSAJE_SIN_CONEXION };
    }
  }

  let cuerpo;
  try {
    cuerpo = construirCuerpo(estado, ruta);
  } catch {
    return { tipo: "error", mensaje: "Faltan datos de tu reserva. Revisa los pasos anteriores." };
  }

  let respuesta: Response;
  try {
    respuesta = await pedir("/api/reservas", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    return { tipo: "error", mensaje: MENSAJE_SIN_CONEXION };
  }

  if (respuesta.status === 201) {
    return { tipo: "ok", respuesta: (await respuesta.json()) as RespuestaDeReserva };
  }
  const { codigo, mensaje } = await leerError(respuesta);
  if (respuesta.status === 409 && codigo === "conflicto") return { tipo: "sin_cupo", mensaje, comprobante: ruta };
  if (respuesta.status === 409 && codigo === "en_espera") return { tipo: "bloqueado", mensaje };
  if (respuesta.status === 409 && codigo === "horario_pendiente") return { tipo: "bloqueado", mensaje, enlace: ENLACE_A_LA_CUENTA };
  if (respuesta.status === 422 && codigo === "comprobante_requerido") return { tipo: "recotizar", mensaje };
  if (respuesta.status === 409 && codigo === "limpieza_gratis_usada") return { tipo: "gratis_usada", mensaje };
  return { tipo: "error", mensaje };
}
