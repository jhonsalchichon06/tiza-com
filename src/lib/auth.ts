import { after } from "next/server";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db/cliente";
import * as esquema from "@/db/esquema";
import { enviarCorreoRestablecimiento, type CorreoRestablecimiento } from "./correo";
import { leerEnvAuth, type EnvAuth } from "./env";

// Opciones que definen el modelo de datos; el esquema de Drizzle debe coincidir con ellas.
export const opcionesAuth = {
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
    resetPasswordTokenExpiresIn: 60 * 60, // el enlace vence a la hora
    revokeSessionsOnPasswordReset: true,
  },
  user: {
    modelName: "usuarios",
    additionalFields: {
      telefono: { type: "string", required: true, input: true },
      // input: false → la biblioteca ignora un `rol` enviado por el navegador.
      rol: { type: "string", defaultValue: "cliente", input: false },
    },
  },
  session: { modelName: "sesiones" }, // sin cookieCache: el rol se lee de la base en cada petición
  account: { modelName: "cuentas" },
  // El token de restablecimiento se guarda solo como hash; lo demás sigue como estaba.
  verification: { modelName: "verificaciones", storeIdentifier: { default: "plain", overrides: { "reset-password:": "hashed" } } },
} satisfies BetterAuthOptions;

export type Correo = {
  enviar: (datos: CorreoRestablecimiento) => Promise<void>;
  // Ejecuta la tarea sin que la respuesta la espere: así el tiempo no delata si la cuenta existe.
  programar: (tarea: () => Promise<void>) => void;
};

export function crearAuth(database: BetterAuthOptions["database"], env: EnvAuth = leerEnvAuth(), correo?: Correo) {
  return betterAuth({
    ...opcionesAuth,
    emailAndPassword: {
      ...opcionesAuth.emailAndPassword,
      // Sin correo configurado, Better Auth rechaza el restablecimiento en vez de aceptarlo sin enviar nada.
      ...(correo && {
        // La URL de Better Auth apunta a /api/auth/*, que no publicamos: el enlace va a nuestra página.
        sendResetPassword: async ({ user, token }) => {
          const enlace = `${env.BETTER_AUTH_URL}/restablecer?token=${encodeURIComponent(token)}`;
          correo.programar(() =>
            correo.enviar({ para: user.email, nombre: user.name, enlace }).catch((error) => {
              console.error("No se pudo enviar el correo de restablecimiento:", error);
            }),
          );
        },
      }),
    },
    database,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
  });
}

export type Auth = ReturnType<typeof crearAuth>;

let instancia: Auth | undefined;

// Perezoso, como db(): `next build` no necesita las variables de entorno.
export function auth(): Auth {
  return (instancia ??= crearAuth(drizzleAdapter(db(), { provider: "pg", schema: esquema }), leerEnvAuth(), {
    enviar: enviarCorreoRestablecimiento,
    programar: (tarea) => after(tarea),
  }));
}
