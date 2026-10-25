import { and, asc, eq, sql } from "drizzle-orm";
import { membresias, pagos } from "@/db/esquema";
import type { BaseDatos } from "../agenda/expirar";
import type { Configuracion } from "../configuracion";
import { reenvioHastaSql, reenvioVigenteSql } from "./plazo";

export type PagoReenviable = {
  pagoId: string;
  membresiaId: string | null;
  // Fin del plazo para subir otro comprobante, como texto ISO en UTC.
  reenvioHasta: string;
  motivoRechazo: string | null;
};

// Definición ÚNICA de «puede subir otro comprobante» (design de revision-de-pagos-admin, decisiones 4 y 7): pagos
// `rechazado` del cliente cuyo plazo sigue vigente según el reloj de la base, que nadie reemplazó todavía y cuya membresía
// (si tiene) no se cerró como `caducada`. El ítem 12 la usa para ofrecer «Sube otro comprobante» y mostrar cuánto plazo queda.
// Es una lectura sobre `revisado_en`, no sobre el estado guardado de la membresía: no depende de que el cierre haya corrido.
export async function pagosRechazadosReenviables(
  base: Pick<BaseDatos, "select">,
  usuarioId: string,
  config: Pick<Configuracion, "reenvio_comprobante_dias">,
): Promise<PagoReenviable[]> {
  const dias = config.reenvio_comprobante_dias;
  const filas = await base
    .select({
      pagoId: pagos.id,
      membresiaId: pagos.membresiaId,
      reenvioHasta: reenvioHastaSql(dias),
      motivoRechazo: pagos.motivoRechazo,
    })
    .from(pagos)
    .leftJoin(membresias, eq(membresias.id, pagos.membresiaId))
    .where(
      and(
        eq(pagos.usuarioId, usuarioId),
        eq(pagos.estado, "rechazado"),
        reenvioVigenteSql(dias),
        sql`NOT EXISTS (SELECT 1 FROM pagos r WHERE r.reemplaza_a = ${pagos.id})`,
        sql`(${membresias.id} IS NULL OR ${membresias.estado} <> 'caducada')`,
      ),
    )
    .orderBy(asc(pagos.revisadoEn));
  return filas.flatMap((f) => (f.reenvioHasta ? [{ ...f, reenvioHasta: f.reenvioHasta }] : []));
}
