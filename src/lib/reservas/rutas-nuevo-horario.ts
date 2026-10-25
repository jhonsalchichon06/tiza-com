import { errorOriginal } from "../agenda/errores-bd";
import { ErrorApi, manejar } from "../errores";
import { conReintento } from "../reintento";
import { requerirSesion, type Usuario } from "../sesion";
import { crearReservaDeNuevoHorario } from "./nuevo-horario";
import { leerDisponibilidadNuevoHorario, leerNuevoHorario } from "./nuevo-horario-datos";

// Rutas del CLIENTE sobre SU pago aprobado (`/api/pagos/[id]/nuevo-horario...`). Patrón de `crearRutaReservas`: sesión
// primero (401), el POST exige JSON (415, para que un formulario de otro sitio con `text/plain` no lo dispare con la cookie),
// el `id` se valida como uuid (si no, 404 y no un 22P02), `conReintento` con el error original de Drizzle y `manejar`.
// No chocan con `POST /api/pagos` (#11) ni con `/api/reservas/[id]` (#12).

const ENCABEZADOS = { "Cache-Control": "private, no-store" };
const desenvolver = (error: unknown) => (error instanceof ErrorApi ? error : errorOriginal(error));
type Contexto = { params: Promise<{ id: string }> };

type Comunes = {
  sesion?: (cabeceras: Headers) => Promise<Usuario>;
  ahora?: () => Date;
  esperaReintentoMs?: number;
};

// GET /api/pagos/[id]/nuevo-horario
export function crearRutaNuevoHorarioDatos({
  sesion = (c) => requerirSesion(c),
  leer = leerNuevoHorario,
  ahora = () => new Date(),
  esperaReintentoMs,
}: Comunes & { leer?: typeof leerNuevoHorario } = {}) {
  return manejar(async (req: Request, { params }: Contexto) => {
    const usuario = await sesion(req.headers);
    const { id } = await params;
    const instante = ahora();
    const resultado = await conReintento(async () => {
      try {
        return await leer({ usuario, pagoId: id, ahora: instante });
      } catch (error) {
        throw desenvolver(error);
      }
    }, esperaReintentoMs);
    return Response.json(resultado, { headers: ENCABEZADOS });
  });
}

// GET /api/pagos/[id]/nuevo-horario/disponibilidad?fecha=AAAA-MM-DD
export function crearRutaNuevoHorarioDisponibilidad({
  sesion = (c) => requerirSesion(c),
  consultar = leerDisponibilidadNuevoHorario,
  ahora = () => new Date(),
  esperaReintentoMs,
}: Comunes & { consultar?: typeof leerDisponibilidadNuevoHorario } = {}) {
  return manejar(async (req: Request, { params }: Contexto) => {
    const usuario = await sesion(req.headers);
    const { id } = await params;
    const fecha = new URL(req.url).searchParams.get("fecha");
    const instante = ahora();
    const resultado = await conReintento(async () => {
      try {
        return await consultar({ usuario, pagoId: id, fecha, ahora: instante });
      } catch (error) {
        throw desenvolver(error);
      }
    }, esperaReintentoMs);
    return Response.json(resultado, { headers: ENCABEZADOS });
  });
}

// POST /api/pagos/[id]/nuevo-horario con { "inicio": "<instante ISO>" }
export function crearRutaNuevoHorarioCrear({
  sesion = (c) => requerirSesion(c),
  crear = crearReservaDeNuevoHorario,
  ahora = () => new Date(),
  esperaReintentoMs,
}: Comunes & { crear?: typeof crearReservaDeNuevoHorario } = {}) {
  return manejar(async (req: Request, { params }: Contexto) => {
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
    const { id } = await params;
    const instante = ahora();
    const resultado = await conReintento(async () => {
      try {
        return await crear({ usuario, pagoId: id, cuerpo, ahora: instante });
      } catch (error) {
        throw desenvolver(error);
      }
    }, esperaReintentoMs);
    return Response.json(resultado, { status: 201, headers: ENCABEZADOS });
  });
}
