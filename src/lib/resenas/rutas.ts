import { errorOriginal } from "../agenda/errores-bd";
import { ErrorApi, manejar } from "../errores";
import { conReintento } from "../reintento";
import { requerirSesion, type Usuario } from "../sesion";
import { esUuid } from "../uuid";
import { crearResena, MENSAJE_RESERVA_NO_ENCONTRADA } from "./crear";
import { editarResena } from "./editar";
import { validarResena } from "./entrada";

// POST y PUT /api/reservas/[id]/resena (design de `resenas`, decisiones 3 y 4). Patrón de las rutas del cliente de #12/#16:
// sesión primero (401), JSON o 415 (un formulario de otro sitio con `text/plain` no puede dispararlas con la cookie), id con
// formato de uuid o 404, cuerpo validado con zod (422), `conReintento` con el error original de Drizzle y `manejar`.
// El `usuario_id` sale de la sesión, nunca de la petición. Un administrador que no es dueño recibe el mismo 404.
const ENCABEZADOS = { "Cache-Control": "private, no-store" };
const desenvolver = (error: unknown) => (error instanceof ErrorApi ? error : errorOriginal(error));
type Contexto = { params: Promise<{ id: string }> };

type Dependencias = {
  sesion?: (cabeceras: Headers) => Promise<Usuario>;
  accion?: typeof crearResena;
  esperaReintentoMs?: number;
};

async function leerCuerpoJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw ErrorApi.invalido("Los datos enviados no son válidos.");
  }
}

function crearRuta(estado: 201 | 200, porDefecto: typeof crearResena) {
  return ({ sesion = (c) => requerirSesion(c), accion = porDefecto, esperaReintentoMs }: Dependencias = {}) =>
    manejar(async (req: Request, { params }: Contexto) => {
      const usuario = await sesion(req.headers);
      if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        throw new ErrorApi(415, "tipo_no_soportado", "Envía los datos en formato JSON.");
      }
      const { id } = await params;
      if (!esUuid(id)) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
      const cuerpo = validarResena(await leerCuerpoJson(req));
      const resena = await conReintento(async () => {
        try {
          return await accion({ usuarioId: usuario.id, reservaId: id, cuerpo });
        } catch (error) {
          throw desenvolver(error);
        }
      }, esperaReintentoMs);
      return Response.json(resena, { status: estado, headers: ENCABEZADOS });
    });
}

// POST: crea la reseña de una limpieza completada. 201 con { id, estrellas, comentario, estado }.
export const crearRutaResena = crearRuta(201, crearResena);
// PUT: edita y reenvía la propia mientras no esté aprobada. 200 con la misma forma.
export const crearRutaEditarResena = crearRuta(200, editarResena);
