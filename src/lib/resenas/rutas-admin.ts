import { revalidatePath } from "next/cache";
import { db } from "@/db/cliente";
import { leerConfiguracion } from "../configuracion";
import { manejar } from "../errores";
import { comunes, ENCABEZADOS, idDe, leerCuerpoOpcional, type Contexto, type DependenciasAdmin } from "../pagos/rutas-admin";
import { decidirResena, listarPendientes, MENSAJE_RESENA_NO_ENCONTRADA } from "./moderar";

// Rutas /api/admin/resenas** (design de `resenas`, decisión 5). Mismo patrón que las de pagos y reservas, cuyos ayudantes se
// reutilizan: 1) `requerirAdmin` primero (401 sin sesión, 403 cliente) y sin leer nada; 2) id con formato de uuid o 404;
// 3) la lógica con `conReintento` y los errores de Drizzle desenvueltos. No hay pasada de expiración propia: la transacción de
// escritura ya marca las vencidas y estas rutas no tocan reservas. Respuestas `private, no-store`.
// Reintento: si el primer intento se confirmó y la conexión se cortó en el COMMIT, el reintento ve el estado ya cambiado y
// responde 409, que es verdad y no duplica nada.

// Al aprobar se pide regenerar la landing y las preguntas (el menú está en ambas). Es un efecto accesorio: si falla, la
// aprobación ya está guardada y la landing se actualiza sola en 5 minutos (`revalidate = 300`).
export function revalidarLanding() {
  revalidatePath("/");
  revalidatePath("/preguntas");
}

type DependenciasLectura = DependenciasAdmin & {
  listar?: typeof listarPendientes;
  base?: () => Parameters<typeof listarPendientes>[0];
  leerZona?: () => Promise<string>;
};

// GET /api/admin/resenas
export function crearRutaListarResenas({
  listar = listarPendientes,
  base = () => db(),
  leerZona = async () => (await leerConfiguracion()).horario_atencion.zona,
  ...resto
}: DependenciasLectura = {}) {
  const { sesion, reintentar } = comunes(resto);
  return manejar(async (req: Request) => {
    await sesion(req.headers);
    const resenas = await reintentar(async () => listar(base(), await leerZona()));
    return Response.json({ resenas }, { headers: ENCABEZADOS });
  });
}

type DependenciasDecision = DependenciasAdmin & { accion?: typeof decidirResena; revalidar?: () => void };

function crearRutaDecision(decision: "aprobada" | "rechazada") {
  return ({ accion = decidirResena, revalidar = revalidarLanding, ...resto }: DependenciasDecision = {}) => {
    const { sesion, reintentar } = comunes(resto);
    return manejar(async (req: Request, contexto: Contexto) => {
      const admin = await sesion(req.headers);
      // Cuerpo opcional `{ revision }`: la huella de lo que el administrador vio (ver `revisionDe`). Sin ella (curl) se decide igual.
      const cuerpo = await leerCuerpoOpcional(req);
      const huella = (cuerpo as { revision?: unknown } | null | undefined)?.revision;
      const revision = typeof huella === "string" ? huella : undefined;
      const id = await idDe(contexto, MENSAJE_RESENA_NO_ENCONTRADA);
      const resultado = await reintentar(() => accion({ id, decision, adminId: admin.id, revision }));
      if (decision === "aprobada") {
        try {
          revalidar();
        } catch (error) {
          console.error("No se pudo pedir la revalidación de la landing (se actualizará sola):", error);
        }
      }
      return Response.json(resultado, { headers: ENCABEZADOS });
    });
  };
}

// POST /api/admin/resenas/[id]/aprobar
export const crearRutaAprobar = crearRutaDecision("aprobada");
// POST /api/admin/resenas/[id]/rechazar
export const crearRutaRechazar = crearRutaDecision("rechazada");
