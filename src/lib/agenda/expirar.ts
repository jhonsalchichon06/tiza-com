import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db/cliente";
import { reservas } from "@/db/esquema";
import { devolverCreditoDeReservas } from "../creditos/transiciones";

export type BaseDatos = ReturnType<typeof db>;
export type Transaccion = Parameters<Parameters<BaseDatos["transaction"]>[0]>[0];

// Marca como `expirada` toda reserva pendiente cuyo plazo venció y devuelve sus ids (ADR 0009).
// La restricción de exclusión no puede usar now(): una pendiente vencida sigue bloqueando el horario
// hasta que alguna escritura la marque. Por eso toda escritura empieza llamando a esta función.
export async function expirarVencidas(tx: Pick<Transaccion, "update" | "select" | "execute">): Promise<string[]> {
  const filas = await tx
    .update(reservas)
    .set({ estado: "expirada", actualizadaEn: sql`now()` })
    .where(and(eq(reservas.estado, "pendiente"), lte(reservas.expiraEn, sql`now()`)))
    .returning({ id: reservas.id });
  const ids = filas.map((f) => f.id);
  // Las horas de crédito que esas reservas tenían reservadas vuelven a su lote original, con su vencimiento (ADR 0012), en la
  // misma transacción: si la escritura que la llamó se deshace, la marca y la devolución se deshacen juntas y la siguiente
  // escritura o la pasada del administrador las repiten. Sin vencidas no hay sentencias nuevas.
  await devolverCreditoDeReservas(tx, ids, { estados: ["reservado"] });
  return ids;
}

// Toda escritura de reservas (crear, aprobar, rechazar, cancelar, reprogramar) va dentro de esta transacción.
// Sin reintento propio: reintentar tras un corte durante el COMMIT podría duplicar la escritura; cada ruta decide.
export async function transaccionDeEscritura<T>(
  fn: (tx: Transaccion) => Promise<T>,
  base: Pick<BaseDatos, "transaction"> = db(),
): Promise<T> {
  return base.transaction(async (tx) => {
    await expirarVencidas(tx);
    return fn(tx);
  });
}
