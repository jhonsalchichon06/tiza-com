import { errorOriginal } from "../agenda/errores-bd";
import { ErrorApi, manejar } from "../errores";
import { conReintento } from "../reintento";
import { requerirSesion, type Usuario } from "../sesion";
import { renovarMembresia } from "./renovar";

const desenvolver = (error: unknown) => (error instanceof ErrorApi ? error : errorOriginal(error));

type DependenciasRenovarRuta = {
  sesion?: (cabeceras: Headers) => Promise<Usuario>;
  renovar?: typeof renovarMembresia;
  ahora?: () => Date;
  esperaReintentoMs?: number;
};

// POST /api/membresia/renovar. Exige JSON (415 si no), igual que `POST /api/reservas`. Reintenta una vez toda la operación si
// Neon estaba dormido: si el primer intento sí se confirmó, el reintento ve la membresía pendiente y responde 409
// `en_espera`, que es verdad y no duplica nada. Ningún monto viaja en el cuerpo: lo fija el plan del servidor.
export function crearRutaRenovar({
  sesion = (cabeceras) => requerirSesion(cabeceras),
  renovar = renovarMembresia,
  ahora = () => new Date(),
  esperaReintentoMs,
}: DependenciasRenovarRuta = {}) {
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
        return await renovar({ usuario, cuerpo, ahora: instante });
      } catch (error) {
        throw desenvolver(error);
      }
    }, esperaReintentoMs);
    return Response.json(resultado, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  });
}
