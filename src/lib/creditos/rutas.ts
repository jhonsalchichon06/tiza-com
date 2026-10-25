import { db } from "@/db/cliente";
import { ejecutarPasadaDeExpiracion } from "../agenda/pasada";
import { errorOriginal } from "../agenda/errores-bd";
import { leerConfiguracion, type Configuracion } from "../configuracion";
import { ErrorApi, manejar } from "../errores";
import { comunes, ENCABEZADOS, type DependenciasAdmin } from "../pagos/rutas-admin";
import { conReintento } from "../reintento";
import { requerirSesion, type Usuario } from "../sesion";
import { detalleCreditosAdmin, leerCreditos, listarCreditosAdmin } from "./consulta";
import type { Ejecutor } from "./sql";

// Rutas de LECTURA del crédito en horas (design de credito-en-horas, decisión 9). El cliente ve solo lo suyo (el `usuario_id`
// sale de la sesión, nunca de la petición); el administrador lee el de cualquier cliente y no puede cambiar nada: cualquier
// otro método responde 405. Nunca se guardan en caché.
const desenvolver = (error: unknown) => (error instanceof ErrorApi ? error : errorOriginal(error));

type ConfigDeLectura = Pick<Configuracion, "horario_atencion">;

type DependenciasCliente = {
  sesion?: (cabeceras: Headers) => Promise<Usuario>;
  base?: () => Ejecutor;
  leerConfig?: () => Promise<ConfigDeLectura>;
  // Persiste las reservas vencidas (y con ellas la devolución de sus horas) antes de leer: la lectura ya excluye lo vencido,
  // pero el saldo debe incluir lo que esas reservas devuelven.
  pasada?: () => Promise<unknown>;
  esperaReintentoMs?: number;
};

// GET /api/creditos
export function crearRutaCreditos({
  sesion = (c) => requerirSesion(c),
  base = () => db(),
  leerConfig = () => leerConfiguracion(),
  pasada = () => ejecutarPasadaDeExpiracion(),
  esperaReintentoMs,
}: DependenciasCliente = {}) {
  return manejar(async (req: Request) => {
    const usuario = await sesion(req.headers);
    const creditos = await conReintento(async () => {
      try {
        await pasada();
        const config = await leerConfig();
        return await leerCreditos(base(), usuario.id, config.horario_atencion.zona);
      } catch (error) {
        throw desenvolver(error);
      }
    }, esperaReintentoMs);
    return Response.json(creditos, { headers: ENCABEZADOS });
  });
}

type DependenciasLecturaAdmin = DependenciasAdmin & {
  base?: () => Ejecutor;
  leerZona?: () => Promise<ConfigDeLectura>;
};
type ContextoCliente = { params: Promise<{ usuarioId: string }> };

// GET /api/admin/creditos
export function crearRutaCreditosAdmin({ base = () => db(), leerZona = () => leerConfiguracion(), ...resto }: DependenciasLecturaAdmin = {}) {
  const { sesion, pasada, reintentar } = comunes(resto);
  return manejar(async (req: Request) => {
    await sesion(req.headers);
    await pasada();
    const clientes = await reintentar(async () => listarCreditosAdmin(base(), (await leerZona()).horario_atencion.zona));
    return Response.json({ clientes }, { headers: ENCABEZADOS });
  });
}

// GET /api/admin/creditos/[usuarioId]
export function crearRutaCreditosAdminDetalle({ base = () => db(), leerZona = () => leerConfiguracion(), ...resto }: DependenciasLecturaAdmin = {}) {
  const { sesion, pasada, reintentar } = comunes(resto);
  return manejar(async (req: Request, contexto: ContextoCliente) => {
    await sesion(req.headers);
    const { usuarioId } = await contexto.params;
    await pasada();
    const detalle = await reintentar(async () => detalleCreditosAdmin(base(), usuarioId, (await leerZona()).horario_atencion.zona));
    return Response.json(detalle, { headers: ENCABEZADOS });
  });
}

// Cualquier método que no sea GET: 405 con el formato único de errores y el encabezado Allow. El administrador no crea ni
// edita créditos a mano (ADR 0012). No lee sesión ni base.
export const metodoNoPermitido = manejar(async () => {
  throw new ErrorApi(405, "metodo_no_permitido", "Este recurso solo se puede consultar.");
});

export function respuestaMetodoNoPermitido(_req?: Request): Promise<Response> {
  void _req;
  return metodoNoPermitido().then((r) => {
    r.headers.set("Allow", "GET");
    return r;
  });
}
