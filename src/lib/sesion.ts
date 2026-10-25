import { headers } from "next/headers";
import { auth, type Auth } from "./auth";
import { ErrorApi } from "./errores";

export type Rol = "cliente" | "admin";

export type Usuario = {
  id: string;
  correo: string;
  nombre: string;
  celular: string;
  rol: Rol;
};

type UsuarioBetterAuth = { id: string; email: string; name: string; telefono?: unknown; rol?: unknown };

// Forma pública del usuario: nunca incluye la contraseña ni su hash.
export function aUsuario(u: UsuarioBetterAuth): Usuario {
  return {
    id: u.id,
    correo: u.email,
    nombre: u.name,
    celular: String(u.telefono ?? ""),
    rol: u.rol === "admin" ? "admin" : "cliente",
  };
}

// Lee la sesión y el rol desde la base en cada llamada (sin caché, ADR 0005).
export async function obtenerUsuario(cabeceras: Headers, a: Auth = auth()): Promise<Usuario | null> {
  const sesion = await a.api.getSession({ headers: cabeceras });
  return sesion ? aUsuario(sesion.user) : null;
}

export async function requerirSesion(cabeceras: Headers, a: Auth = auth()): Promise<Usuario> {
  const usuario = await obtenerUsuario(cabeceras, a);
  if (!usuario) throw ErrorApi.sinSesion();
  return usuario;
}

export async function requerirAdmin(cabeceras: Headers, a: Auth = auth()): Promise<Usuario> {
  const usuario = await requerirSesion(cabeceras, a);
  if (usuario.rol !== "admin") throw ErrorApi.sinPermiso();
  return usuario;
}

// Para páginas del servidor: el usuario de la petición actual, o null.
export async function usuarioActual(): Promise<Usuario | null> {
  return obtenerUsuario(new Headers(await headers()));
}
