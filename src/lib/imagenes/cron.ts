import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/db/cliente";
import { ErrorApi, manejar } from "../errores";
import { leerEnvCron } from "../env";
import { COLUMNAS_CON_IMAGEN, leerRutasReferenciadas } from "./referencias";
import { limpiarHuerfanos, type ResultadoLimpieza } from "./huerfanos";

// Compara en tiempo constante: se comparan los hashes, que siempre miden lo mismo.
function mismoSecreto(recibido: string, esperado: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(recibido), h(esperado));
}

type Dependencias = {
  leerSecreto?: () => string;
  limpiar?: () => Promise<ResultadoLimpieza>;
};

// GET /api/cron/huerfanos, llamado una vez al día por el cron de Vercel con `Authorization: Bearer <CRON_SECRET>`.
// No acepta la sesión de ningún usuario (ni la de un administrador): solo el secreto del cron.
export function crearRutaCronHuerfanos({
  leerSecreto = () => leerEnvCron().CRON_SECRET,
  limpiar = () =>
    limpiarHuerfanos({
      leerReferencias: () => leerRutasReferenciadas(db()),
      columnasDeclaradas: COLUMNAS_CON_IMAGEN.length,
    }),
}: Dependencias = {}) {
  return manejar(async (req: Request) => {
    let secreto: string;
    try {
      secreto = leerSecreto();
    } catch (error) {
      console.error("El cron de huérfanos no está configurado:", error);
      throw ErrorApi.noDisponible();
    }
    const cabecera = req.headers.get("authorization") ?? "";
    if (!mismoSecreto(cabecera, `Bearer ${secreto}`)) throw new ErrorApi(401, "sin_sesion", "No autorizado.");

    const resultado = await limpiar();
    return Response.json(resultado, { headers: { "Cache-Control": "no-store" } });
  });
}
