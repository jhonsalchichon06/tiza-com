import { z } from "zod";

type Fuente = Record<string, string | undefined>;

function leer<T extends z.ZodType>(esquema: T, fuente: Fuente): z.infer<T> {
  const resultado = esquema.safeParse(fuente);
  if (resultado.success) return resultado.data;
  const faltan = [...new Set(resultado.error.issues.map((i) => String(i.path[0])))];
  throw new Error(`Falta configurar (o es inválida) la variable de entorno: ${faltan.join(", ")}`);
}

const esquemaBase = z.object({
  DATABASE_URL: z.string().min(1),
});

export type Env = z.infer<typeof esquemaBase>;

export function leerEnv(fuente: Fuente = process.env): Env {
  return leer(esquemaBase, fuente);
}

// Separada de leerEnv para que /api/salud no dependa de las variables de autenticación.
const esquemaAuth = z
  .object({
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url().optional(),
    VERCEL_URL: z.string().min(1).optional(),
  })
  .transform(({ BETTER_AUTH_SECRET, BETTER_AUTH_URL, VERCEL_URL }) => ({
    BETTER_AUTH_SECRET,
    // En los previews de Vercel la URL cambia en cada despliegue.
    BETTER_AUTH_URL: BETTER_AUTH_URL ?? (VERCEL_URL ? `https://${VERCEL_URL}` : undefined),
  }))
  .refine((env) => env.BETTER_AUTH_URL !== undefined, { path: ["BETTER_AUTH_URL"] });

export type EnvAuth = { BETTER_AUTH_SECRET: string; BETTER_AUTH_URL: string };

export function leerEnvAuth(fuente: Fuente = process.env): EnvAuth {
  return leer(esquemaAuth, fuente) as EnvAuth;
}

// Separada para que solo el envío de correos dependa de Resend.
const esquemaCorreo = z.object({
  RESEND_API_KEY: z.string().min(1),
  CORREO_REMITENTE: z.string().min(1),
});

export type EnvCorreo = z.infer<typeof esquemaCorreo>;

export function leerEnvCorreo(fuente: Fuente = process.env): EnvCorreo {
  return leer(esquemaCorreo, fuente);
}

// Separadas para que solo las imágenes dependan de Blob y solo el cron dependa de su secreto.
const esquemaBlob = z.object({ BLOB_READ_WRITE_TOKEN: z.string().min(1) });

export type EnvBlob = z.infer<typeof esquemaBlob>;

export function leerEnvBlob(fuente: Fuente = process.env): EnvBlob {
  return leer(esquemaBlob, fuente);
}

// Opcional: sin número (o con uno inválido) el enlace de WhatsApp es null y la reserva se crea igual.
// Número con código de país y solo dígitos; el valor vive en el entorno, nunca en el repositorio.
export function leerEnvWhatsapp(fuente: Fuente = process.env): { WHATSAPP_NUMERO: string | null } {
  const numero = fuente.WHATSAPP_NUMERO?.trim();
  return { WHATSAPP_NUMERO: numero && /^\d{8,15}$/.test(numero) ? numero : null };
}

const esquemaCron =z.object({ CRON_SECRET: z.string().min(32) });

export type EnvCron = z.infer<typeof esquemaCron>;

export function leerEnvCron(fuente: Fuente = process.env): EnvCron {
  return leer(esquemaCron, fuente);
}
