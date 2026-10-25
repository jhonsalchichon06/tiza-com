import { and, eq } from "drizzle-orm";
import { db } from "@/db/cliente";
import { pagos, reservas, resenas } from "@/db/esquema";
import type { BaseDatos } from "../agenda/expirar";
import { leerConfiguracion } from "../configuracion";
import { ErrorApi } from "../errores";
import { listarFotosDeReserva, type FotoVista } from "../fotos/listar";
import type { Usuario } from "../sesion";
import { esUuid } from "../uuid";
import { aReservaVista, columnasDeVista, dentroDelPlazo, type ConfigPerfil, type FilaVista, type ReservaVista } from "./reservas";

export const MENSAJE_RESERVA_NO_ENCONTRADA = "No encontramos esa reserva.";

export type PagoVista = {
  id: string;
  concepto: string;
  monto: number;
  metodo: string;
  estado: string;
  motivo_rechazo: string | null;
  // Ruta del comprobante por /api (ADR 0010); solo si el pago tiene imagen.
  comprobante: string | null;
};

// Reseña propia de la limpieza (ítem 18). Nunca incluye quién la revisó.
export type ResenaVista = { estrellas: number; comentario: string; estado: "pendiente" | "aprobada" | "rechazada" };

export type DetalleReserva = ReservaVista & {
  puede_reprogramar: boolean;
  puede_cancelar: boolean;
  pago: PagoVista | null;
  resena: ResenaVista | null;
  // Verdadero si la limpieza está completada y todavía no tiene reseña.
  puede_resenar: boolean;
  // Fotos del servicio (ítem 17): solo de una limpieza completada; `[]` en las demás. Nunca con `ruta` ni URL de Blob: la imagen
  // se pide a `/api/fotos/<id>`, que decide el permiso.
  fotos: FotoVista[];
};

export type DependenciasDetalle = {
  base: () => Pick<BaseDatos, "select">;
  leerConfig: () => Promise<ConfigPerfil>;
};

const porDefecto: DependenciasDetalle = { base: () => db(), leerConfig: () => leerConfiguracion() };

// Detalle de UNA reserva del cliente. El dueño va en el mismo WHERE que el id: no existe una consulta "por id" sin dueño
// (ADR 0005). Un id mal formado, inexistente o de otro cliente (también si quien pregunta es administrador sin ser el
// dueño) responde el mismo 404 con el mismo mensaje. Nunca devuelve `equipo_id`. Las fotos son de #17; la reseña (propia) de #18.
export async function leerDetalleReserva(entrada: { usuario: Pick<Usuario, "id">; reservaId: string; ahora: Date }, dependencias: DependenciasDetalle = porDefecto): Promise<DetalleReserva> {
  return (await leerDetalleConZona(entrada, dependencias)).detalle;
}

// Lo mismo, más la zona de `configuracion` que la página usa para escribir las fechas (no forma parte de la respuesta de la API).
export async function leerDetalleConZona(
  { usuario, reservaId, ahora }: { usuario: Pick<Usuario, "id">; reservaId: string; ahora: Date },
  dependencias: DependenciasDetalle = porDefecto,
): Promise<{ detalle: DetalleReserva; zona: string }> {
  if (!esUuid(reservaId)) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
  const base = dependencias.base();
  const [fila] = (await base
    .select({ ...columnasDeVista, pagoId: reservas.pagoId })
    .from(reservas)
    .where(and(eq(reservas.id, reservaId), eq(reservas.usuarioId, usuario.id)))
    .limit(1)) as (FilaVista & { pagoId: string })[];
  if (!fila) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);

  const config = await dependencias.leerConfig();
  const [pago] = await base
    .select({
      id: pagos.id,
      concepto: pagos.concepto,
      monto: pagos.monto,
      metodo: pagos.metodo,
      estado: pagos.estado,
      motivoRechazo: pagos.motivoRechazo,
      comprobanteRuta: pagos.comprobanteRuta,
    })
    .from(pagos)
    .where(and(eq(pagos.id, fila.pagoId), eq(pagos.usuarioId, usuario.id)))
    .limit(1);

  // La reseña se lee DESPUÉS de comprobar que la reserva es del cliente de la sesión: nunca por `reserva_id` suelto.
  const [resena] = await base
    .select({ estrellas: resenas.estrellas, comentario: resenas.comentario, estado: resenas.estado })
    .from(resenas)
    .where(eq(resenas.reservaId, fila.id))
    .limit(1);

  const vista = aReservaVista(fila, config.horario_atencion.zona);
  // Las fotos también se leen DESPUÉS de comprobar el dueño, y solo si la limpieza está completada (única que puede tenerlas).
  const fotos = vista.estado === "completada" ? await listarFotosDeReserva(base, fila.id) : [];
  const cambiable = (vista.estado === "pendiente" || vista.estado === "confirmada") && fila.inicio.getTime() > ahora.getTime() && dentroDelPlazo(config, ahora, fila.inicio);
  const detalle: DetalleReserva = {
    ...vista,
    puede_reprogramar: cambiable,
    puede_cancelar: cambiable,
    pago: pago
      ? {
          id: pago.id,
          concepto: pago.concepto,
          monto: pago.monto,
          metodo: pago.metodo,
          estado: pago.estado,
          motivo_rechazo: pago.motivoRechazo,
          comprobante: pago.comprobanteRuta ? `/api/comprobantes/${pago.id}` : null,
        }
      : null,
    resena: resena ? { estrellas: resena.estrellas, comentario: resena.comentario, estado: resena.estado } : null,
    puede_resenar: vista.estado === "completada" && !resena,
    fotos,
  };
  return { detalle, zona: config.horario_atencion.zona };
}
