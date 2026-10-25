import { errorOriginal } from "../agenda/errores-bd";
import { ErrorApi, manejar } from "../errores";
import { conReintento } from "../reintento";
import { requerirSesion, type Usuario } from "../sesion";
import { leerDetalleReserva, type DependenciasDetalle } from "./detalle";
import { leerPerfil, type DependenciasPerfil } from "./resumen";

// Rutas de LECTURA del cliente (`/api/perfil`, `/api/reservas/[id]`). `requerirSesion` va primero (401); la respuesta nunca
// se guarda en caché. Solo ven datos de quien tiene la sesión: el `usuario_id` sale de la sesión, nunca de la petición.
const ENCABEZADOS = { "Cache-Control": "private, no-store" };
const desenvolver = (error: unknown) => (error instanceof ErrorApi ? error : errorOriginal(error));

type DependenciasRutaPerfil = {
  sesion?: (cabeceras: Headers) => Promise<Usuario>;
  leer?: typeof leerPerfil;
  dependencias?: Partial<DependenciasPerfil>;
  ahora?: () => Date;
};

// GET /api/perfil
export function crearRutaPerfil({ sesion = (c) => requerirSesion(c), leer = leerPerfil, dependencias, ahora = () => new Date() }: DependenciasRutaPerfil = {}) {
  return manejar(async (req: Request) => {
    const usuario = await sesion(req.headers);
    const resultado = await leer({ usuario, ahora: ahora() }, dependencias);
    return Response.json(resultado, { headers: ENCABEZADOS });
  });
}

type Contexto = { params: Promise<{ id: string }> };
type DependenciasRutaDetalle = {
  sesion?: (cabeceras: Headers) => Promise<Usuario>;
  leer?: typeof leerDetalleReserva;
  dependencias?: DependenciasDetalle;
  ahora?: () => Date;
  esperaReintentoMs?: number;
};

// GET /api/reservas/[id]. Un id sin formato de uuid, inexistente o ajeno responde el mismo 404.
export function crearRutaDetalleReserva({
  sesion = (c) => requerirSesion(c),
  leer = leerDetalleReserva,
  dependencias,
  ahora = () => new Date(),
  esperaReintentoMs,
}: DependenciasRutaDetalle = {}) {
  return manejar(async (req: Request, { params }: Contexto) => {
    const usuario = await sesion(req.headers);
    const { id } = await params;
    const instante = ahora();
    const detalle = await conReintento(async () => {
      try {
        return await (dependencias ? leer({ usuario, reservaId: id, ahora: instante }, dependencias) : leer({ usuario, reservaId: id, ahora: instante }));
      } catch (error) {
        throw desenvolver(error);
      }
    }, esperaReintentoMs);
    return Response.json({ reserva: detalle }, { headers: ENCABEZADOS });
  });
}
