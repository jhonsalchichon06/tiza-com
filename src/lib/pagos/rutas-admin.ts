import { db } from "@/db/cliente";
import { ejecutarPasadaDeExpiracion } from "../agenda/pasada";
import { errorOriginal } from "../agenda/errores-bd";
import { leerConfiguracion, type Configuracion } from "../configuracion";
import { ErrorApi, manejar } from "../errores";
import { cancelarReservaComoAdmin } from "../reservas/cancelar-admin";
import { conReintento } from "../reintento";
import { requerirAdmin, type Usuario } from "../sesion";
import { esUuid } from "../uuid";
import { detalleDePago, listarPagos } from "./listado";
import { aprobarPago, rechazarPago } from "./revision";

// Rutas /api/admin/** de la revisión de pagos (design de revision-de-pagos-admin, decisiones 1 y 5). Cada una:
// 1) exige rol admin (401 sin sesión, 403 cliente) ANTES de leer nada; 2) valida el id (404 si no es uuid); 3) ejecuta la
// pasada de expiración, que persiste las marcas `expirada` y el cierre de membresías sin depender del cron; 4) hace su
// trabajo. Las dos fases van en su propio `conReintento` con `errorOriginal`, porque Drizzle envuelve el error de la base.
const desenvolver = (error: unknown) => (error instanceof ErrorApi ? error : errorOriginal(error));

export const ENCABEZADOS = { "Cache-Control": "private, no-store" };
export type Contexto = { params: Promise<{ id: string }> };

export type DependenciasAdmin = {
  sesion?: (cabeceras: Headers) => Promise<Usuario>;
  pasada?: () => Promise<unknown>;
  leerConfig?: () => Promise<Pick<Configuracion, "reenvio_comprobante_dias" | "horario_atencion">>;
  esperaReintentoMs?: number;
};

export function comunes({ sesion = (c) => requerirAdmin(c), pasada = () => ejecutarPasadaDeExpiracion(), esperaReintentoMs }: DependenciasAdmin) {
  const reintentar = <T>(operacion: () => Promise<T>) =>
    conReintento(async () => {
      try {
        return await operacion();
      } catch (error) {
        throw desenvolver(error);
      }
    }, esperaReintentoMs);
  return { sesion, pasada: () => reintentar(pasada), reintentar };
}

// Las acciones POST aceptan un cuerpo opcional, pero si llega debe ser JSON (415 si no): un formulario de otro sitio con
// `text/plain` no puede dispararlas con la cookie de sesión.
export async function leerCuerpoOpcional(req: Request): Promise<unknown> {
  const texto = await req.text();
  if (texto.trim() === "") return undefined;
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ErrorApi(415, "tipo_no_soportado", "Envía los datos en formato JSON.");
  }
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    throw ErrorApi.invalido("Los datos enviados no son válidos.");
  }
}

export async function idDe(contexto: Contexto, mensaje: string): Promise<string> {
  const { id } = await contexto.params;
  if (!esUuid(id)) throw ErrorApi.noEncontrado(mensaje);
  return id;
}

type DependenciasAccion<A> = DependenciasAdmin & { accion?: A };

// POST /api/admin/pagos/[id]/aprobar
export function crearRutaAprobar({ accion = aprobarPago, ...resto }: DependenciasAccion<typeof aprobarPago> = {}) {
  const { sesion, pasada, reintentar } = comunes(resto);
  return manejar(async (req: Request, contexto: Contexto) => {
    const admin = await sesion(req.headers);
    await leerCuerpoOpcional(req);
    const pagoId = await idDe(contexto, "No encontramos ese pago.");
    await pasada();
    const resultado = await reintentar(() => accion({ admin, pagoId }));
    return Response.json(resultado, { headers: ENCABEZADOS });
  });
}

// POST /api/admin/pagos/[id]/rechazar  { motivo? }
export function crearRutaRechazar({ accion = rechazarPago, ...resto }: DependenciasAccion<typeof rechazarPago> = {}) {
  const { sesion, pasada, reintentar } = comunes(resto);
  return manejar(async (req: Request, contexto: Contexto) => {
    const admin = await sesion(req.headers);
    const cuerpo = await leerCuerpoOpcional(req);
    const pagoId = await idDe(contexto, "No encontramos ese pago.");
    await pasada();
    const resultado = await reintentar(() => accion({ admin, pagoId, cuerpo }));
    return Response.json(resultado, { headers: ENCABEZADOS });
  });
}

// POST /api/admin/reservas/[id]/cancelar
export function crearRutaCancelarReserva({ accion = cancelarReservaComoAdmin, ...resto }: DependenciasAccion<typeof cancelarReservaComoAdmin> = {}) {
  const { sesion, pasada, reintentar } = comunes(resto);
  return manejar(async (req: Request, contexto: Contexto) => {
    await sesion(req.headers);
    await leerCuerpoOpcional(req);
    const reservaId = await idDe(contexto, "No encontramos esa reserva.");
    await pasada();
    const resultado = await reintentar(() => accion({ reservaId }));
    return Response.json(resultado, { headers: ENCABEZADOS });
  });
}

type DependenciasLectura = DependenciasAdmin & {
  listar?: typeof listarPagos;
  detalle?: typeof detalleDePago;
  base?: () => Parameters<typeof listarPagos>[0];
};

// GET /api/admin/pagos?estado=pendiente|aprobado|rechazado
export function crearRutaListaDePagos({ listar = listarPagos, base = () => db(), leerConfig = () => leerConfiguracion(), ...resto }: DependenciasLectura = {}) {
  const { sesion, pasada, reintentar } = comunes(resto);
  return manejar(async (req: Request) => {
    await sesion(req.headers);
    const estado = new URL(req.url).searchParams.get("estado");
    await pasada();
    const pagos = await reintentar(async () => listar(base(), { estado }, await leerConfig()));
    return Response.json({ pagos }, { headers: ENCABEZADOS });
  });
}

// GET /api/admin/pagos/[id]
export function crearRutaDetalleDePago({ detalle = detalleDePago, base = () => db(), leerConfig = () => leerConfiguracion(), ...resto }: DependenciasLectura = {}) {
  const { sesion, pasada, reintentar } = comunes(resto);
  return manejar(async (req: Request, contexto: Contexto) => {
    await sesion(req.headers);
    const id = await idDe(contexto, "No encontramos ese pago.");
    await pasada();
    const pago = await reintentar(async () => detalle(base(), id, await leerConfig()));
    return Response.json(pago, { headers: ENCABEZADOS });
  });
}
