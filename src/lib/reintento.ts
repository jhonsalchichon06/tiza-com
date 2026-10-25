import { ErrorApi } from "./errores";

const CODIGOS_DE_RED = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"]);
// 08xxx: error de conexión; 57P01-57P03: servidor apagándose o arrancando; 53300: sin conexiones.
const SQLSTATE_DE_CONEXION = /^(08|57P0[1-3]|53300)/;
const MENSAJE_DE_CONEXION =
  /connection (terminated|timeout|closed)|websocket|control plane|fetch failed|server closed the connection/i;

export function esErrorDeConexion(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === "string") {
    if (CODIGOS_DE_RED.has(code) || SQLSTATE_DE_CONEXION.test(code)) return true;
    // Cualquier otro SQLSTATE (restricciones, sintaxis…) es un error de datos: no se reintenta.
    if (/^[0-9A-Z]{5}$/.test(code)) return false;
  }
  return typeof message === "string" && MENSAJE_DE_CONEXION.test(message);
}

// Neon se suspende tras inactividad: un solo reintento y, si falla, 503 "inténtalo en unos segundos".
// Debe rodear la operación completa, no una sentencia suelta dentro de una transacción.
export async function conReintento<T>(operacion: () => Promise<T>, esperaMs = 500): Promise<T> {
  try {
    return await operacion();
  } catch (error) {
    if (!esErrorDeConexion(error)) throw error;
    console.warn("Neon no respondió; reintentando una vez:", error);
  }
  await new Promise((resolver) => setTimeout(resolver, esperaMs));
  try {
    return await operacion();
  } catch (error) {
    if (!esErrorDeConexion(error)) throw error;
    console.error("Neon sigue sin responder tras el reintento:", error);
    throw ErrorApi.noDisponible();
  }
}
