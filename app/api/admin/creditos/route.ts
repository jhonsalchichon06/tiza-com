import { crearRutaCreditosAdmin, respuestaMetodoNoPermitido } from "@/lib/creditos/rutas";

export const GET = crearRutaCreditosAdmin();
// El administrador solo consulta el crédito (ADR 0012): cualquier otro método es 405.
export const POST = respuestaMetodoNoPermitido;
export const PUT = respuestaMetodoNoPermitido;
export const PATCH = respuestaMetodoNoPermitido;
export const DELETE = respuestaMetodoNoPermitido;
