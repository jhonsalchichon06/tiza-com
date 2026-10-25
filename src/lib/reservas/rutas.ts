import { db } from "@/db/cliente";
import { entradaDeServicio } from "../agenda/consulta";
import { errorOriginal } from "../agenda/errores-bd";
import { leerConfiguracion, type Configuracion } from "../configuracion";
import { claveHogar, validarDireccion, type ClaveHogar } from "../direccion";
import { ErrorApi, manejar } from "../errores";
import { conReintento } from "../reintento";
import { requerirSesion, type Usuario } from "../sesion";
import { calcularServicio } from "../precios";
import { cotizarPrimeraReserva, cotizarReservaDeMiembro } from "./cotizar";
import { crearReserva } from "./crear";
import { creditoParaReserva } from "./credito";
import { motivoSinGratis, type MotivoSinGratis } from "./gratis";
import { leerMembresiaQueAutoriza, type MembresiaQueAutoriza } from "./membresia-vigente";

// Drizzle envuelve el error de la base en `cause`; `conReintento` necesita el original para reconocer un corte de conexión.
// Los ErrorApi (409, 422…) pasan tal cual.
const desenvolver = (error: unknown) => (error instanceof ErrorApi ? error : errorOriginal(error));

type DependenciasReservas = {
  sesion?: (cabeceras: Headers) => Promise<Usuario>;
  crear?: typeof crearReserva;
  ahora?: () => Date;
  esperaReintentoMs?: number;
};

// POST /api/reservas. Exige JSON (415 si no) para que un formulario de otro sitio con `text/plain` no la dispare
// con la cookie de sesión. Reintenta una vez toda la operación si Neon está dormido: si el primer intento se
// confirmó, el reintento choca con los índices únicos y responde 409, que es verdad y no duplica nada.
export function crearRutaReservas({
  sesion = (cabeceras) => requerirSesion(cabeceras),
  crear = crearReserva,
  ahora = () => new Date(),
  esperaReintentoMs,
}: DependenciasReservas = {}) {
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

    const instante = ahora();
    const resultado = await conReintento(async () => {
      try {
        return await crear({ usuario, cuerpo, ahora: instante });
      } catch (error) {
        throw desenvolver(error);
      }
    }, esperaReintentoMs);
    return Response.json(resultado, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  });
}

type DependenciasCotizacion = {
  sesion?: (cabeceras: Headers) => Promise<Usuario>;
  leerConfig?: () => Promise<Configuracion>;
  // Lectura de solo lectura de por qué no aplican las horas gratis (null si aplican). Sin hogar decide solo por el cliente.
  decidir?: (usuarioId: string, hogar: ClaveHogar | null) => Promise<MotivoSinGratis | null>;
  // La membresía `activa` que autoriza reservar (null si el cliente no tiene ninguna): decide el modo de la cotización.
  leerMembresia?: (usuarioId: string) => Promise<MembresiaQueAutoriza | null>;
  // Saldo de crédito en horas vigente del cliente (ítem 14); `calcularServicio` lo acota por las horas a cobrar.
  credito?: (usuarioId: string, horasMaximas: number) => Promise<number>;
  ahora?: () => Date;
  esperaReintentoMs?: number;
};

const DIRECCION = ["distrito", "calle", "numero"] as const;

// GET /api/cotizacion. Solo lectura: calcula en el servidor lo que el asistente muestra (ADR 0008). Con la dirección
// (distrito, calle, número y, opcional, departamento) decide también por el hogar, igual que `POST /api/reservas`.
export function crearRutaCotizacion({
  sesion = (cabeceras) => requerirSesion(cabeceras),
  leerConfig = () => leerConfiguracion(),
  decidir = (usuarioId, hogar) => motivoSinGratis(db(), usuarioId, hogar),
  leerMembresia = (usuarioId) => leerMembresiaQueAutoriza(db(), usuarioId),
  credito = (usuarioId, horasMaximas) => creditoParaReserva(db(), usuarioId, horasMaximas),
  ahora = () => new Date(),
  esperaReintentoMs,
}: DependenciasCotizacion = {}) {
  return manejar(async (req: Request) => {
    const usuario = await sesion(req.headers);
    const parametros = new URL(req.url).searchParams;
    const servicio = entradaDeServicio(parametros);
    // Con alguno de distrito, calle o número se valida la dirección completa (422) antes de leer reservas.
    const hogar = DIRECCION.some((c) => parametros.get(c) !== null)
      ? claveHogar(
          validarDireccion({
            distrito: parametros.get("distrito") ?? undefined,
            calle: parametros.get("calle") ?? undefined,
            numero: parametros.get("numero") ?? undefined,
            departamento: parametros.get("departamento") ?? undefined,
          }),
        )
      : null;
    const cotizacion = await conReintento(async () => {
      try {
        const config = await leerConfig();
        const motivo = await decidir(usuario.id, hogar);
        const aplicaGratis = motivo === null;
        // El modo lo decide la membresía del cliente, no el navegador: un miembro activo cotiza solo la limpieza.
        const membresia = await leerMembresia(usuario.id);
        if (!membresia) return cotizarPrimeraReserva(config, servicio, ahora(), { aplicaGratis, motivoSinGratis: motivo });
        const { horas_cobrar } = calcularServicio(config, { ...servicio, aplicaGratis });
        const creditoHoras = await credito(usuario.id, horas_cobrar);
        return cotizarReservaDeMiembro(config, servicio, ahora(), { aplicaGratis, motivoSinGratis: motivo, creditoHoras, membresiaFin: membresia.fin });
      } catch (error) {
        throw desenvolver(error);
      }
    }, esperaReintentoMs);
    return Response.json(cotizacion, { headers: { "Cache-Control": "private, no-store" } });
  });
}
