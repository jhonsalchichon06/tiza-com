import { conReintento } from "../reintento";
import { ErrorApi, manejar } from "../errores";
import { errorOriginal } from "../agenda/errores-bd";
import { requerirAdmin, type Usuario } from "../sesion";
import { esUuid } from "../uuid";
import { registrarFotos } from "./registrar";

const ENCABEZADOS = { "Cache-Control": "private, no-store" };
const desenvolver = (error: unknown) => (error instanceof ErrorApi ? error : errorOriginal(error));

type Contexto = { params: Promise<{ id: string }> };

export type DependenciasRutaFotos = {
  sesion?: (cabeceras: Headers) => Promise<Usuario>;
  registrar?: typeof registrarFotos;
  esperaReintentoMs?: number;
};

// POST /api/admin/reservas/[id]/fotos   { fotos: [{ ruta, ambiente }] }   →   201 [{ id, ambiente }]
// Mismo patrón que las rutas de administración de #16: 1) `requerirAdmin` primero (401 sin sesión, 403 cliente) y sin ejecutar
// nada más; 2) JSON o 415 (un formulario de otro sitio con `text/plain` no puede dispararla con la cookie de sesión); 3) id con
// formato de uuid o 404; 4) cuerpo JSON legible o 422; 5) la lógica con `conReintento` y los errores de Drizzle desenvueltos.
//
// Reintento: si el primer intento se confirmó y la conexión se cortó en el COMMIT, el segundo choca con la ruta única y
// responde 409 («Esas fotos ya estaban registradas.»), que es verdad y no duplica nada.
export function crearRutaRegistrarFotos({ sesion = (c) => requerirAdmin(c), registrar = registrarFotos, esperaReintentoMs }: DependenciasRutaFotos = {}) {
  return manejar(async (req: Request, contexto: Contexto) => {
    const admin = await sesion(req.headers);
    if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new ErrorApi(415, "tipo_no_soportado", "Envía los datos en formato JSON.");
    }
    const { id } = await contexto.params;
    if (!esUuid(id)) throw ErrorApi.noEncontrado("No encontramos esa reserva.");
    let cuerpo: unknown;
    try {
      cuerpo = await req.json();
    } catch {
      throw ErrorApi.invalido("Los datos enviados no son válidos.");
    }
    const fotos = await conReintento(async () => {
      try {
        return await registrar({ usuario: admin, reservaId: id, cuerpo });
      } catch (error) {
        throw desenvolver(error);
      }
    }, esperaReintentoMs);
    return Response.json(fotos, { status: 201, headers: ENCABEZADOS });
  });
}
