import { errorOriginal } from "../agenda/errores-bd";
import { ErrorApi, manejar } from "../errores";
import { conReintento } from "../reintento";
import { requerirSesion, type Usuario } from "../sesion";
import { cancelarReservaDelCliente, ErrorFueraDePlazo } from "./cancelar";
import { consultarDisponibilidadDeReserva } from "./disponibilidad-propia";
import { reprogramarReserva } from "./reprogramar";

// Rutas del CLIENTE sobre SU reserva (`/api/reservas/[id]/...`). Patrón de `crearRutaReservas`: sesión primero (401), las
// POST exigen JSON (415, para que un formulario de otro sitio con `text/plain` no las dispare con la cookie), el `id` se
// valida como uuid (si no, 404 y no un 22P02), `conReintento` con el error original de Drizzle y `manejar`.
// Cancelar es idempotente, así que reintentar tras un COMMIT perdido responde 200.

const ENCABEZADOS = { "Cache-Control": "private, no-store" };
const desenvolver = (error: unknown) => (error instanceof ErrorApi ? error : errorOriginal(error));
type Contexto = { params: Promise<{ id: string }> };

type Comunes = {
  sesion?: (cabeceras: Headers) => Promise<Usuario>;
  ahora?: () => Date;
  esperaReintentoMs?: number;
};

function exigirJson(req: Request) {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ErrorApi(415, "tipo_no_soportado", "Envía los datos en formato JSON.");
  }
}

// 409 `fuera_de_plazo` con el enlace de WhatsApp (o null) junto al formato único de errores.
function respuestaFueraDePlazo(error: ErrorFueraDePlazo) {
  return Response.json({ error: { codigo: error.codigo, mensaje: error.message, whatsapp: error.whatsapp } }, { status: 409, headers: ENCABEZADOS });
}

async function leerCuerpoJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw ErrorApi.invalido("Los datos enviados no son válidos.");
  }
}

// POST /api/reservas/[id]/cancelar
export function crearRutaCancelar({
  sesion = (c) => requerirSesion(c),
  cancelar = cancelarReservaDelCliente,
  ahora = () => new Date(),
  esperaReintentoMs,
}: Comunes & { cancelar?: typeof cancelarReservaDelCliente } = {}) {
  return manejar(async (req: Request, { params }: Contexto) => {
    const usuario = await sesion(req.headers);
    exigirJson(req);
    const { id } = await params;
    const instante = ahora();
    try {
      const resultado = await conReintento(async () => {
        try {
          return await cancelar({ usuario, reservaId: id, ahora: instante });
        } catch (error) {
          throw desenvolver(error);
        }
      }, esperaReintentoMs);
      return Response.json(resultado, { headers: ENCABEZADOS });
    } catch (error) {
      if (error instanceof ErrorFueraDePlazo) return respuestaFueraDePlazo(error);
      throw error;
    }
  });
}

// POST /api/reservas/[id]/reprogramar con { "inicio": "<instante ISO>" }
export function crearRutaReprogramar({
  sesion = (c) => requerirSesion(c),
  reprogramar = reprogramarReserva,
  ahora = () => new Date(),
  esperaReintentoMs,
}: Comunes & { reprogramar?: typeof reprogramarReserva } = {}) {
  return manejar(async (req: Request, { params }: Contexto) => {
    const usuario = await sesion(req.headers);
    exigirJson(req);
    const cuerpo = await leerCuerpoJson(req);
    const { id } = await params;
    const instante = ahora();
    try {
      const resultado = await conReintento(async () => {
        try {
          return await reprogramar({ usuario, reservaId: id, cuerpo, ahora: instante });
        } catch (error) {
          throw desenvolver(error);
        }
      }, esperaReintentoMs);
      return Response.json(resultado, { headers: ENCABEZADOS });
    } catch (error) {
      if (error instanceof ErrorFueraDePlazo) return respuestaFueraDePlazo(error);
      throw error;
    }
  });
}

// GET /api/reservas/[id]/disponibilidad?fecha=AAAA-MM-DD
export function crearRutaDisponibilidadDeReserva({
  sesion = (c) => requerirSesion(c),
  consultar = consultarDisponibilidadDeReserva,
  ahora = () => new Date(),
  esperaReintentoMs,
}: Comunes & { consultar?: typeof consultarDisponibilidadDeReserva } = {}) {
  return manejar(async (req: Request, { params }: Contexto) => {
    const usuario = await sesion(req.headers);
    const { id } = await params;
    const fecha = new URL(req.url).searchParams.get("fecha");
    const instante = ahora();
    const resultado = await conReintento(async () => {
      try {
        return await consultar({ usuarioId: usuario.id, reservaId: id, fecha, ahora: instante });
      } catch (error) {
        throw desenvolver(error);
      }
    }, esperaReintentoMs);
    return Response.json(resultado, { headers: ENCABEZADOS });
  });
}
