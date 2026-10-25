import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/cliente";
import { membresias, pagos, reservas } from "@/db/esquema";
import { transaccionDeEscritura, type BaseDatos, type Transaccion } from "../agenda/expirar";
import { isoConZona } from "../agenda/horario";
import { leerConfiguracion, type Configuracion } from "../configuracion";
import { ErrorApi } from "../errores";
import type { Usuario } from "../sesion";
import { validar } from "../validacion-sesion";
import { esUuid } from "../uuid";
import { generarCreditoDeCancelacion } from "../creditos/lotes";
import { consumirCreditoDeReservas } from "../creditos/transiciones";
import { reenvioHastaSql, reenvioVigenteSql } from "./plazo";

export type DependenciasRevision = {
  base: () => Pick<BaseDatos, "transaction">;
  leerConfig: () => Promise<Pick<Configuracion, "membresia_meses" | "reenvio_comprobante_dias" | "horario_atencion" | "credito_vence_meses">>;
};

const porDefecto: DependenciasRevision = {
  base: () => db(),
  leerConfig: () => leerConfiguracion(),
};

export const MENSAJE_PAGO_NO_ENCONTRADO = "No encontramos ese pago.";
export const MENSAJE_PAGO_YA_REVISADO = "Ese pago ya fue revisado. Actualiza la lista para ver su estado.";
export const MENSAJE_MEMBRESIA_NO_PENDIENTE = "La membresía de ese pago ya no está pendiente, así que no se puede aprobar.";

type Admin = Pick<Usuario, "id">;
type Lector = Pick<Transaccion, "select">;

const fecha = (instante: Date | null, zona: string) => (instante ? isoConZona(instante, zona) : null);

// Bloquea la fila del pago. 404 si no existe (o el id no es un uuid) y 409 si ya no está pendiente: dos administradores
// que revisan el mismo pago a la vez se serializan aquí y el segundo recibe el 409.
async function bloquearPagoPendiente(tx: Lector, pagoId: string) {
  if (!esUuid(pagoId)) throw ErrorApi.noEncontrado(MENSAJE_PAGO_NO_ENCONTRADO);
  const [pago] = await tx.select().from(pagos).where(eq(pagos.id, pagoId)).for("update");
  if (!pago) throw ErrorApi.noEncontrado(MENSAJE_PAGO_NO_ENCONTRADO);
  if (pago.estado !== "pendiente") throw ErrorApi.conflicto(MENSAJE_PAGO_YA_REVISADO);
  return pago;
}

export type RespuestaAprobacion = {
  pago: { id: string; concepto: string; monto: number; metodo: string; estado: string; revisado_en: string | null };
  membresia: { id: string; estado: string; inicio: string | null; fin: string | null } | null;
  reserva: { id: string; estado: string; expira_en: string | null } | null;
  // Verdadero cuando el pago quedó aprobado y no tiene ninguna reserva viva o realizada: el cliente debe elegir un nuevo
  // día y hora sin volver a pagar (aprobación tardía, ADR 0009). Ver `pagosConHorarioPendiente`.
  nuevo_horario_pendiente: boolean;
  // Crédito en horas que esta aprobación generó (la reserva ya estaba cancelada por el cliente), o null (ADR 0012).
  credito_generado: { horas: number; vence_en: string } | null;
};

// Aprueba un pago en una sola transacción (design de revision-de-pagos-admin, decisión 2): bloquea el pago, activa la
// membresía y confirma la reserva `pendiente`. `inicio` y `fin` salen de `now()` de la base (la aprobación), no de
// `pagos.creado_en` ni del reloj del servidor, y la duración sale de `configuracion`.
//
// Aprobación tardía: `transaccionDeEscritura` marca las vencidas con el mismo `now()` al empezar, así que una reserva
// vencida ya está `expirada` y el UPDATE de confirmar no la toca: nunca se confirma un horario vencido. Una reserva
// `expirada` o `cancelada` sigue como está y la respuesta trae `nuevo_horario_pendiente: true`.
//
// Crédito en horas (ítem 14, ADR 0012): las reservas que se confirman pasan sus usos de crédito de `reservado` a `consumido`;
// una reserva expirada o cancelada por el administrador no toca los usos (ya volvieron a su lote); y si la reserva fue
// cancelada por el CLIENTE antes de esta aprobación, aquí se genera su lote de crédito (si no, lo generó la cancelación).
// Orden de bloqueo: pago, luego reserva (su UPDATE) y luego los lotes.
export async function aprobarPago(
  { admin, pagoId }: { admin: Admin; pagoId: string },
  dependencias: DependenciasRevision = porDefecto,
): Promise<RespuestaAprobacion> {
  const config = await dependencias.leerConfig();
  const zona = config.horario_atencion.zona;

  return transaccionDeEscritura(async (tx) => {
    const pago = await bloquearPagoPendiente(tx, pagoId);

    // La membresía primero: si ya no está pendiente, el 409 sale antes de escribir nada.
    let membresia: typeof membresias.$inferSelect | null = null;
    if (pago.concepto !== "reserva") {
      if (pago.membresiaId === null) throw new Error("Un pago con membresía no tiene membresia_id");
      const activadas = await tx
        .update(membresias)
        .set({ estado: "activa", inicio: sql`now()`, fin: sql`now() + make_interval(months => ${config.membresia_meses}::int)` })
        .where(and(eq(membresias.id, pago.membresiaId), eq(membresias.estado, "pendiente")))
        .returning();
      if (activadas.length === 0) throw ErrorApi.conflicto(MENSAJE_MEMBRESIA_NO_PENDIENTE);
      membresia = activadas[0];
    }

    const [aprobado] = await tx
      .update(pagos)
      .set({ estado: "aprobado", revisadoPor: admin.id, revisadoEn: sql`now()` })
      .where(eq(pagos.id, pago.id))
      .returning();

    const confirmadas = await tx
      .update(reservas)
      .set({ estado: "confirmada", expiraEn: null, actualizadaEn: sql`now()` })
      .where(and(eq(reservas.pagoId, pago.id), eq(reservas.estado, "pendiente")))
      .returning();
    await consumirCreditoDeReservas(tx, confirmadas.map((r) => r.id));

    let reserva: typeof reservas.$inferSelect | null = confirmadas[0] ?? null;
    let nuevoHorarioPendiente = false;
    let creditoGenerado: RespuestaAprobacion["credito_generado"] = null;
    if (!reserva) {
      const delPago = await tx.select().from(reservas).where(eq(reservas.pagoId, pago.id)).orderBy(desc(reservas.creadaEn));
      reserva = delPago[0] ?? null;
      nuevoHorarioPendiente = !delPago.some((r) => r.estado === "confirmada" || r.estado === "completada");
      for (const r of delPago) {
        if (r.estado !== "cancelada" || r.canceladaPor !== "cliente") continue;
        const lote = await generarCreditoDeCancelacion(tx, r.id, config.credito_vence_meses);
        if (lote && !creditoGenerado) creditoGenerado = { horas: lote.horas, vence_en: isoConZona(lote.venceEn, zona) };
      }
    }

    return {
      pago: {
        id: aprobado.id,
        concepto: aprobado.concepto,
        monto: aprobado.monto,
        metodo: aprobado.metodo,
        estado: aprobado.estado,
        revisado_en: fecha(aprobado.revisadoEn, zona),
      },
      membresia: membresia && {
        id: membresia.id,
        estado: membresia.estado,
        inicio: fecha(membresia.inicio, zona),
        fin: fecha(membresia.fin, zona),
      },
      reserva: reserva && { id: reserva.id, estado: reserva.estado, expira_en: fecha(reserva.expiraEn, zona) },
      nuevo_horario_pendiente: nuevoHorarioPendiente,
      credito_generado: creditoGenerado,
    };
  }, dependencias.base());
}

export const MOTIVO_MAXIMO = 200;

const esquemaRechazo = z.object({
  motivo: z
    .string({ error: "Revisa el motivo." })
    .trim()
    .max(MOTIVO_MAXIMO, { error: `El motivo puede tener hasta ${MOTIVO_MAXIMO} caracteres.` })
    .nullish(),
});

export type RespuestaRechazo = {
  pago: { id: string; estado: string; motivo_rechazo: string | null; revisado_en: string | null };
  // Plazo para subir otro comprobante (PRD, caso borde 1): `revisado_en` + `reenvio_comprobante_dias`. El texto que lo
  // muestra al cliente lo pone el ítem 12.
  reenvio_hasta: string | null;
  reenvio_vigente: boolean;
};

// Rechaza un pago: no toca la reserva (sigue `pendiente` con su `expira_en`) ni la membresía.
// Tampoco toca el crédito en horas (ADR 0012, design de credito-en-horas, decisión 5): la reserva sigue en espera y el cliente
// puede subir otro comprobante, así que sus usos siguen `reservado`. Las horas vuelven a su lote cuando la reserva expira
// (`expirarVencidas`) o se cancela; devolverlas aquí dejaría una reserva confirmada con un crédito que ya no está descontado.
export async function rechazarPago(
  { admin, pagoId, cuerpo }: { admin: Admin; pagoId: string; cuerpo?: unknown },
  dependencias: DependenciasRevision = porDefecto,
): Promise<RespuestaRechazo> {
  const { motivo } = validar(esquemaRechazo, cuerpo ?? {});
  const config = await dependencias.leerConfig();
  const zona = config.horario_atencion.zona;
  const dias = config.reenvio_comprobante_dias;

  return transaccionDeEscritura(async (tx) => {
    const pago = await bloquearPagoPendiente(tx, pagoId);
    const [rechazado] = await tx
      .update(pagos)
      .set({ estado: "rechazado", revisadoPor: admin.id, revisadoEn: sql`now()`, motivoRechazo: motivo || null })
      .where(eq(pagos.id, pago.id))
      .returning({
        id: pagos.id,
        estado: pagos.estado,
        motivoRechazo: pagos.motivoRechazo,
        revisadoEn: pagos.revisadoEn,
        reenvioHasta: reenvioHastaSql(dias),
        reenvioVigente: reenvioVigenteSql(dias),
      });
    return {
      pago: { id: rechazado.id, estado: rechazado.estado, motivo_rechazo: rechazado.motivoRechazo, revisado_en: fecha(rechazado.revisadoEn, zona) },
      reenvio_hasta: rechazado.reenvioHasta ? isoConZona(new Date(rechazado.reenvioHasta), zona) : null,
      reenvio_vigente: Boolean(rechazado.reenvioVigente),
    };
  }, dependencias.base());
}
