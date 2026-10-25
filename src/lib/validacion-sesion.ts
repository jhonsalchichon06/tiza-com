import { z } from "zod";
import { ErrorApi } from "./errores";

const correo = z
  .string({ error: "Escribe tu correo." })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Escribe un correo válido, por ejemplo nombre@correo.com." }));

const contrasenaNueva = z
  .string({ error: "Escribe una contraseña." })
  .min(8, { error: "La contraseña debe tener al menos 8 caracteres." })
  .max(128, { error: "La contraseña es demasiado larga." });

export const esquemaRegistro = z.object({
  correo,
  contrasena: contrasenaNueva,
  nombre: z
    .string({ error: "Escribe tu nombre." })
    .trim()
    .min(1, { error: "Escribe tu nombre." })
    .max(100, { error: "El nombre es demasiado largo." }),
  celular: z
    .string({ error: "Escribe tu celular." })
    .transform((v) => v.replace(/\s/g, ""))
    .pipe(z.string().regex(/^9\d{8}$/, { error: "Escribe un celular de 9 dígitos que empiece con 9." })),
});

export const esquemaInicio = z.object({
  correo,
  contrasena: z.string({ error: "Escribe tu contraseña." }).min(1, { error: "Escribe tu contraseña." }),
});

export const esquemaOlvide = z.object({ correo });

export const esquemaRestablecer = z.object({
  token: z.string({ error: "El enlace no es válido." }).min(1, { error: "El enlace no es válido." }).max(256),
  contrasena: contrasenaNueva,
});

// Valida el cuerpo; ante el primer error responde 422 con su mensaje en español.
export function validar<T extends z.ZodType>(esquema: T, cuerpo: unknown): z.infer<T> {
  const resultado = esquema.safeParse(cuerpo);
  if (resultado.success) return resultado.data;
  throw ErrorApi.invalido(resultado.error.issues[0]?.message ?? "Revisa los datos.");
}

export const MENSAJE_ENLACE_INVALIDO = "El enlace no es válido o ya venció. Pide uno nuevo.";
export const MENSAJE_CREDENCIALES = "Correo o contraseña incorrectos.";

// Traduce los errores conocidos de Better Auth; lo demás sigue como error inesperado (500).
export function traducirErrorAuth(error: unknown): unknown {
  const codigo = (error as { body?: { code?: unknown } })?.body?.code;
  if (typeof codigo !== "string") return error;
  if (codigo.startsWith("USER_ALREADY_EXISTS")) {
    return ErrorApi.conflicto("Ese correo ya tiene una cuenta. Inicia sesión.");
  }
  if (codigo === "INVALID_EMAIL_OR_PASSWORD") {
    return new ErrorApi(401, "credenciales_invalidas", MENSAJE_CREDENCIALES);
  }
  // Token usado, vencido o inventado (o de una cuenta que ya no existe): la misma respuesta para todos.
  if (codigo === "INVALID_TOKEN" || codigo === "USER_NOT_FOUND") {
    return new ErrorApi(400, "enlace_invalido", MENSAJE_ENLACE_INVALIDO);
  }
  if (codigo === "PASSWORD_TOO_SHORT") {
    return ErrorApi.invalido("La contraseña debe tener al menos 8 caracteres.");
  }
  return error;
}
