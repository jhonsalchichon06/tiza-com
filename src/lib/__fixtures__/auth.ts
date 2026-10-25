import { memoryAdapter } from "better-auth/adapters/memory";
import { crearAuth } from "../auth";
import type { CorreoRestablecimiento } from "../correo";

export const ENV_PRUEBA = { BETTER_AUTH_SECRET: "s".repeat(40), BETTER_AUTH_URL: "http://localhost:3000" };

// Better Auth real sobre una base en memoria: hash, sesiones y roles sin tocar Neon.
export function authEnMemoria() {
  const datos: Record<string, Record<string, unknown>[]> = { usuarios: [], sesiones: [], cuentas: [], verificaciones: [] };
  // Correos "enviados": se guardan en una lista y se ejecutan al instante, sin red.
  const correos: CorreoRestablecimiento[] = [];
  const correo = {
    enviar: async (c: CorreoRestablecimiento) => void correos.push(c),
    programar: (tarea: () => Promise<void>) => void tarea(),
  };
  return { auth: crearAuth(memoryAdapter(datos), ENV_PRUEBA, correo), datos, correos };
}

// Convierte las cabeceras Set-Cookie de una respuesta en una cabecera Cookie para la siguiente petición.
export function cookieDe(respuesta: { headers: Headers }): string {
  return respuesta.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

export const DATOS_REGISTRO = { email: "ana@correo.com", password: "clave-segura-1", name: "Ana", telefono: "987654321" };

// Registra una cuenta y devuelve las cabeceras con su cookie de sesión.
export async function registrarConSesion(a: ReturnType<typeof crearAuth>, datos = DATOS_REGISTRO) {
  const res = await a.api.signUpEmail({ body: datos, returnHeaders: true });
  return new Headers({ cookie: cookieDe(res) });
}
