import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { ErrorApi, manejar } from "../errores";
import { leerEnvBlob } from "../env";
import { requerirSesion, type Usuario } from "../sesion";
import { validarRutaSubida } from "./rutas";
import { MAX_BYTES_SUBIDO, TIPOS_PERMITIDOS } from "./tipos";

type ManejadorDeSubida = typeof handleUpload;

// Emite el token de subida directa a Blob (ADR 0010). La carpeta sale de la sesión: el navegador solo propone
// el nombre, y `validarRutaSubida` rechaza cualquier ruta fuera de la carpeta del usuario (fotos: solo admin).
// El almacén (`handleUpload`) se inyecta para probar sin red. No se usa `onUploadCompleted`: la fila se crea
// en la ruta de negocio con la ruta que el navegador ya conoce.
export async function manejarSolicitudSubida(
  { cuerpo, request, usuario, token }: { cuerpo: HandleUploadBody; request: Request; usuario: Pick<Usuario, "id" | "rol">; token: string },
  almacen: ManejadorDeSubida = handleUpload,
) {
  return almacen({
    token,
    request,
    body: cuerpo,
    onBeforeGenerateToken: async (pathname) => {
      validarRutaSubida({ ruta: pathname, usuario });
      return {
        allowedContentTypes: [...TIPOS_PERMITIDOS],
        maximumSizeInBytes: MAX_BYTES_SUBIDO,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ usuarioId: usuario.id }),
      };
    },
  });
}

type Dependencias = {
  sesion?: (cabeceras: Headers) => Promise<Usuario>;
  almacen?: ManejadorDeSubida;
  leerToken?: () => string;
};

// POST /api/subidas. Sin BLOB_READ_WRITE_TOKEN responde 503 y deja el detalle en el log del servidor.
export function crearRutaSubidas({
  sesion = (cabeceras) => requerirSesion(cabeceras),
  almacen = handleUpload,
  leerToken = () => leerEnvBlob().BLOB_READ_WRITE_TOKEN,
}: Dependencias = {}) {
  return manejar(async (req: Request) => {
    const usuario = await sesion(req.headers);
    if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new ErrorApi(415, "tipo_no_soportado", "Envía los datos en formato JSON.");
    }
    let cuerpo: unknown;
    try {
      cuerpo = await req.json();
    } catch {
      throw ErrorApi.invalido("Los datos enviados no son válidos.");
    }
    if (typeof cuerpo !== "object" || cuerpo === null || typeof (cuerpo as { type?: unknown }).type !== "string") {
      throw ErrorApi.invalido("Los datos enviados no son válidos.");
    }

    let token: string;
    try {
      token = leerToken();
    } catch (error) {
      console.error("Vercel Blob no está configurado:", error);
      throw ErrorApi.noDisponible();
    }

    const respuesta = await manejarSolicitudSubida({ cuerpo: cuerpo as HandleUploadBody, request: req, usuario, token }, almacen);
    return Response.json(respuesta);
  });
}
