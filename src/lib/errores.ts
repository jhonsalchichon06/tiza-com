import { NextResponse } from "next/server";

export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }

  static sinSesion = () => new ErrorApi(401, "sin_sesion", "Inicia sesión para continuar.");
  static sinPermiso = () => new ErrorApi(403, "sin_permiso", "No tienes permiso para hacer esto.");
  static noEncontrado = (mensaje = "No encontramos lo que buscas.") =>
    new ErrorApi(404, "no_encontrado", mensaje);
  static conflicto = (mensaje: string) => new ErrorApi(409, "conflicto", mensaje);
  static invalido = (mensaje: string) => new ErrorApi(422, "datos_invalidos", mensaje);
  static noDisponible = () =>
    new ErrorApi(503, "no_disponible", "Inténtalo en unos segundos.");
}

export function respuestaError(error: ErrorApi) {
  return NextResponse.json(
    { error: { codigo: error.codigo, mensaje: error.message } },
    { status: error.status },
  );
}

type Handler<A extends unknown[]> = (...args: A) => Promise<Response> | Response;

// Envuelve un Route Handler: ErrorApi sale con su código; lo demás es un 500 genérico.
export function manejar<A extends unknown[]>(handler: Handler<A>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ErrorApi) return respuestaError(error);
      console.error("Error inesperado en /api:", error);
      return respuestaError(
        new ErrorApi(500, "error_interno", "Algo salió mal. Inténtalo de nuevo."),
      );
    }
  };
}
