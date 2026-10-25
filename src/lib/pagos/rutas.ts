import { errorOriginal } from "../agenda/errores-bd";
import { ErrorApi, manejar } from "../errores";
import { conReintento } from "../reintento";
import { requerirSesion, type Usuario } from "../sesion";
import { reenviarComprobante } from "./reenvio";

const desenvolver = (error: unknown) => (error instanceof ErrorApi ? error : errorOriginal(error));

type DependenciasPagos = {
  sesion?: (cabeceras: Headers) => Promise<Usuario>;
  reenviar?: typeof reenviarComprobante;
  ahora?: () => Date;
  esperaReintentoMs?: number;
};

// POST /api/pagos: el cliente sube otro comprobante a un pago rechazado. Exige JSON (415 si no), igual que
// `POST /api/reservas`. Reintenta una vez toda la operación si Neon estaba dormido: si el primer intento sí se confirmó, el
// reintento ve el pago ya reemplazado y responde 409, que es verdad y no duplica nada.
export function crearRutaPagos({
  sesion = (cabeceras) => requerirSesion(cabeceras),
  reenviar = reenviarComprobante,
  ahora = () => new Date(),
  esperaReintentoMs,
}: DependenciasPagos = {}) {
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
        return await reenviar({ usuario, cuerpo, ahora: instante });
      } catch (error) {
        throw desenvolver(error);
      }
    }, esperaReintentoMs);
    return Response.json(resultado, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  });
}
