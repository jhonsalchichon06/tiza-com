import { db } from "@/db/cliente";
import { leerConfiguracion } from "../../configuracion";
import { manejar } from "../../errores";
import { comunes, ENCABEZADOS, idDe, leerCuerpoOpcional, type Contexto, type DependenciasAdmin } from "../../pagos/rutas-admin";
import { listarApoyoPorCoordinar, marcarApoyoCoordinado } from "./apoyo";
import { completarReserva } from "./completar";
import { consultarDisponibilidadAdmin } from "./disponibilidad";
import { listarReservas } from "./listado";
import { reasignarReserva } from "./reasignar";
import { reprogramarReservaPorAdmin } from "./reprogramar";

// Rutas /api/admin/** de la gestión de reservas (design de gestion-de-reservas-y-apoyo, decisión 1). Mismo patrón que las de
// revisión de pagos (`src/lib/pagos/rutas-admin.ts`, cuyos ayudantes se reutilizan): 1) `requerirAdmin` primero (401 sin
// sesión, 403 cliente) y sin leer nada; 2) cuerpo JSON o 415; 3) id con formato de uuid o 404; 4) la pasada de expiración con
// reintento; 5) la lógica, con `conReintento` y los errores de Drizzle desenvueltos. Respuestas `private, no-store`.
//
// Reintento: si el primer intento se confirmó y la conexión se cortó en el COMMIT, el reintento ve el estado ya cambiado y
// responde 409, que es verdad y no duplica nada. En `apoyo` repetir es válido (solo reescribe la nota): el reintento da 200.

type DependenciasLectura<L> = DependenciasAdmin & {
  listar?: L;
  base?: () => Parameters<typeof listarReservas>[0];
};
type DependenciasAccion<A> = DependenciasAdmin & { accion?: A };

// GET /api/admin/reservas?estado=pendiente|confirmada|completada|cancelada|expirada|por_completar
export function crearRutaListado({ listar = listarReservas, base = () => db(), leerConfig = () => leerConfiguracion(), ...resto }: DependenciasLectura<typeof listarReservas> = {}) {
  const { sesion, pasada, reintentar } = comunes(resto);
  return manejar(async (req: Request) => {
    await sesion(req.headers);
    const estado = new URL(req.url).searchParams.get("estado");
    await pasada();
    const resultado = await reintentar(async () => listar(base(), { estado }, await leerConfig()));
    return Response.json(resultado, { headers: ENCABEZADOS });
  });
}

// GET /api/admin/apoyo
export function crearRutaApoyo({ listar = listarApoyoPorCoordinar, base = () => db(), leerConfig = () => leerConfiguracion(), ...resto }: DependenciasLectura<typeof listarApoyoPorCoordinar> = {}) {
  const { sesion, pasada, reintentar } = comunes(resto);
  return manejar(async (req: Request) => {
    await sesion(req.headers);
    await pasada();
    const apoyo = await reintentar(async () => listar(base(), await leerConfig()));
    return Response.json({ apoyo }, { headers: ENCABEZADOS });
  });
}

// POST /api/admin/reservas/[id]/completar   (sin cuerpo; si llega, debe ser JSON)
export function crearRutaCompletar({ accion = completarReserva, ...resto }: DependenciasAccion<typeof completarReserva> = {}) {
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

// POST /api/admin/reservas/[id]/reasignar   { equipo_id }
export function crearRutaReasignar({ accion = reasignarReserva, ...resto }: DependenciasAccion<typeof reasignarReserva> = {}) {
  const { sesion, pasada, reintentar } = comunes(resto);
  return manejar(async (req: Request, contexto: Contexto) => {
    await sesion(req.headers);
    const cuerpo = await leerCuerpoOpcional(req);
    const reservaId = await idDe(contexto, "No encontramos esa reserva.");
    await pasada();
    const resultado = await reintentar(() => accion({ reservaId, cuerpo }));
    return Response.json(resultado, { headers: ENCABEZADOS });
  });
}

// POST /api/admin/reservas/[id]/apoyo   { nota? }
export function crearRutaMarcarApoyo({ accion = marcarApoyoCoordinado, ...resto }: DependenciasAccion<typeof marcarApoyoCoordinado> = {}) {
  const { sesion, pasada, reintentar } = comunes(resto);
  return manejar(async (req: Request, contexto: Contexto) => {
    await sesion(req.headers);
    const cuerpo = await leerCuerpoOpcional(req);
    const reservaId = await idDe(contexto, "No encontramos esa reserva.");
    await pasada();
    const resultado = await reintentar(() => accion({ reservaId, cuerpo }));
    return Response.json(resultado, { headers: ENCABEZADOS });
  });
}

// POST /api/admin/reservas/[id]/reprogramar   { inicio }
// El administrador mueve la reserva a nombre del cliente (apoyo no conseguido; decisión pendiente de confirmar por el negocio).
export function crearRutaReprogramar({
  accion = reprogramarReservaPorAdmin,
  ahora = () => new Date(),
  ...resto
}: DependenciasAccion<typeof reprogramarReservaPorAdmin> & { ahora?: () => Date } = {}) {
  const { sesion, pasada, reintentar } = comunes(resto);
  return manejar(async (req: Request, contexto: Contexto) => {
    const admin = await sesion(req.headers);
    const cuerpo = await leerCuerpoOpcional(req);
    const reservaId = await idDe(contexto, "No encontramos esa reserva.");
    await pasada();
    const instante = ahora();
    const resultado = await reintentar(() => accion({ reservaId, cuerpo, adminId: admin.id, ahora: instante }));
    return Response.json(resultado, { headers: ENCABEZADOS });
  });
}

// GET /api/admin/reservas/[id]/disponibilidad?fecha=AAAA-MM-DD
export function crearRutaDisponibilidadAdmin({
  consultar = consultarDisponibilidadAdmin,
  ahora = () => new Date(),
  ...resto
}: DependenciasAdmin & { consultar?: typeof consultarDisponibilidadAdmin; ahora?: () => Date } = {}) {
  const { sesion, pasada, reintentar } = comunes(resto);
  return manejar(async (req: Request, contexto: Contexto) => {
    await sesion(req.headers);
    const reservaId = await idDe(contexto, "No encontramos esa reserva.");
    const fecha = new URL(req.url).searchParams.get("fecha");
    await pasada();
    const instante = ahora();
    const resultado = await reintentar(() => consultar({ reservaId, fecha, ahora: instante }));
    return Response.json(resultado, { headers: ENCABEZADOS });
  });
}
