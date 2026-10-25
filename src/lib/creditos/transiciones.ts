import { sql } from "drizzle-orm";
import { generarCreditoDeCancelacion, type LoteGenerado } from "./lotes";
import { aNumero, filas, lista, type Ejecutor } from "./sql";

// Qué hace cada cambio de estado de una reserva con los usos y los lotes de crédito (ADR 0012; design de credito-en-horas,
// decisiones 5 y 6). Invariante por lote: `horas_disponibles` + horas de sus usos `reservado` y `consumido` = `horas_iniciales`.
//
// ORDEN DE BLOQUEO ÚNICO (decisión 6): primero las reservas, después los lotes y los lotes siempre por `id`. `aprobar` bloquea
// el pago, luego la reserva y luego los lotes; cancelar (cliente o administrador) bloquea la reserva y luego los lotes;
// `expirarVencidas` actualiza reservas y luego lotes; la reserva nueva bloquea los lotes antes de insertar una fila que nadie
// más puede referenciar. Ninguna ruta toma un lote y después una reserva ya existente, así que no hay ciclos. La cancelación
// NO bloquea el pago: invertiría el orden de `aprobar` y abriría un interbloqueo.
//
// Ninguna función cambia `vence_en`: devolver horas a un lote ya vencido no las recupera (cancelar y volver a reservar no
// sirve para alargar el vencimiento).

// Confirmar la reserva: los usos `reservado` pasan a `consumido` (ya no pueden devolverse por expiración).
export async function consumirCreditoDeReservas(tx: Ejecutor, reservaIds: string[]): Promise<void> {
  if (reservaIds.length === 0) return;
  await tx.execute(sql`
    UPDATE "usos_credito" SET "estado" = 'consumido', "actualizado_en" = now()
    WHERE "reserva_destino_id" IN ${lista(reservaIds)} AND "estado" = 'reservado'`);
}

export type EstadoDeUso = "reservado" | "consumido";
export type Devolucion = { creditoId: string; horas: number };

// Devuelve a su lote original las horas de los usos de esas reservas que estén en alguno de `estados`. Bloquea primero los
// lotes afectados (`ORDER BY id FOR UPDATE`) y luego pasa los usos a `devuelto` y suma las horas en una sola sentencia.
export async function devolverCreditoDeReservas(
  tx: Ejecutor,
  reservaIds: string[],
  { estados }: { estados: EstadoDeUso[] },
): Promise<Devolucion[]> {
  if (reservaIds.length === 0 || estados.length === 0) return [];
  const ids = lista(reservaIds);
  const estadosSql = lista(estados);
  const bloqueados = filas(
    await tx.execute(sql`
      SELECT "id" FROM "creditos_horas"
      WHERE "id" IN (SELECT "credito_id" FROM "usos_credito" WHERE "reserva_destino_id" IN ${ids} AND "estado" IN ${estadosSql})
      ORDER BY "id" FOR UPDATE`),
  );
  if (bloqueados.length === 0) return [];
  const devueltas = filas<{ id: string; horas: string }>(
    await tx.execute(sql`
      WITH "devueltos" AS (
        UPDATE "usos_credito" SET "estado" = 'devuelto', "actualizado_en" = now()
        WHERE "reserva_destino_id" IN ${ids} AND "estado" IN ${estadosSql}
        RETURNING "credito_id", "horas"
      ), "sumas" AS (
        SELECT "credito_id", SUM("horas") AS "horas" FROM "devueltos" GROUP BY "credito_id"
      )
      UPDATE "creditos_horas" c SET "horas_disponibles" = c."horas_disponibles" + s."horas"
      FROM "sumas" s WHERE c."id" = s."credito_id"
      RETURNING c."id", s."horas"`),
  );
  return devueltas.map((d) => ({ creditoId: d.id, horas: aNumero(d.horas) }));
}

export type ResultadoCancelacion = { generado: LoteGenerado | null; devuelto: Devolucion[]; devueltoHoras: number };

// Cancelación del cliente (la reserva ya quedó `cancelada`, con `cancelada_en` guardado y bloqueada por quien llama): devuelve
// los usos `reservado` y `consumido` a su lote original y genera el lote de lo pagado en dinero si el pago está `aprobado` (si
// no, se genera cuando el administrador lo apruebe).
//
// `cancelada_en` (que fija el vencimiento del crédito) lo escribe quien llama en el MISMO `UPDATE` que cambia el estado: un
// segundo `UPDATE` de la misma fila, dentro de la misma transacción, obliga a Postgres a comprobar de nuevo la clave foránea
// hacia `pagos` (toma `FOR KEY SHARE` sobre el pago), y eso espera a `aprobar`, que tiene el pago bloqueado y espera esta reserva:
// un interbloqueo. Comprobado contra Neon (credito.bd.test.ts, «la cancelación no toma bloqueo sobre el pago»).
export async function cancelarConCredito(tx: Ejecutor, reserva: { id: string }, mesesVence: number): Promise<ResultadoCancelacion> {
  const devuelto = await devolverCreditoDeReservas(tx, [reserva.id], { estados: ["reservado", "consumido"] });
  const generado = await generarCreditoDeCancelacion(tx, reserva.id, mesesVence);
  return { generado, devuelto, devueltoHoras: devuelto.reduce((s, d) => s + d.horas, 0) };
}

// Cancelación del administrador (solo reservas `pendiente`; `cancelada_en` ya lo guardó quien llama en el mismo `UPDATE` del
// estado, por la misma razón): devuelve los usos `reservado`; nunca genera un lote (la cancelación la causa Tiza, no el cliente).
export async function cancelarComoAdminConCredito(tx: Ejecutor, reserva: { id: string }): Promise<Devolucion[]> {
  return devolverCreditoDeReservas(tx, [reserva.id], { estados: ["reservado"] });
}
