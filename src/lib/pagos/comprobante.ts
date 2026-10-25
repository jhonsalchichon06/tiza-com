import { eq } from "drizzle-orm";
import { db } from "@/db/cliente";
import { pagos } from "@/db/esquema";
import { errorOriginal } from "../agenda/errores-bd";
import { ErrorApi } from "../errores";
import { autorizarComprobantePorCarpeta, type RecursoEntregable } from "../imagenes/entrega";
import { conReintento } from "../reintento";
import type { Usuario } from "../sesion";

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PagoParaEntrega = { usuarioId: string; comprobanteRuta: string | null };

async function buscarPagoEnBase(id: string): Promise<PagoParaEntrega | null> {
  const [pago] = await db()
    .select({ usuarioId: pagos.usuarioId, comprobanteRuta: pagos.comprobanteRuta })
    .from(pagos)
    .where(eq(pagos.id, id))
    .limit(1);
  return pago ?? null;
}

// Resolvedor de `crearRutaEntrega` para `GET /api/comprobantes/:id`. Devuelve null (→ 404) si el id no tiene formato
// de uuid (sin esto, un `abc` provocaría un error de Postgres 22P02 y un 500), si el pago no existe o si no tiene
// comprobante (los pagos internos con crédito). Autoriza a un administrador, o al dueño del pago cuando la ruta
// además está en su carpeta: dos comprobaciones, para que un error futuro en una no abra el acceso.
export async function obtenerComprobante(
  id: string,
  _usuario: Usuario,
  buscarPago: (id: string) => Promise<PagoParaEntrega | null> = buscarPagoEnBase,
): Promise<RecursoEntregable | null> {
  if (!FORMATO_UUID.test(id)) return null;
  const pago = await conReintento(async () => {
    try {
      return await buscarPago(id);
    } catch (error) {
      throw error instanceof ErrorApi ? error : errorOriginal(error);
    }
  });
  if (!pago?.comprobanteRuta) return null;
  return {
    ruta: pago.comprobanteRuta,
    autorizar: (usuario, ruta) =>
      usuario.rol === "admin" || (usuario.id === pago.usuarioId && autorizarComprobantePorCarpeta(usuario, ruta)),
  };
}
