import { and, eq, inArray, sql } from "drizzle-orm";
import { membresias } from "@/db/esquema";
import type { Transaccion } from "../agenda/expirar";

// Pasa a `caducada` toda membresía `pendiente` que no tiene ningún pago `pendiente`, tiene al menos un pago `rechazado`
// y cuyos pagos rechazados ya superaron el plazo de reenvío (PRD, caso borde 1; design de revision-de-pagos-admin, decisión 4).
// Devuelve los ids cerrados. `plazoDias` llega de `configuracion` (`reenvio_comprobante_dias`): nunca un 7 en el código.
// El reloj es el `now()` de la base, igual que la expiración de reservas.
//
// Dos sentencias a propósito: la primera BLOQUEA las filas candidatas y la segunda evalúa la condición. En READ COMMITTED
// cada sentencia ve su propia instantánea, así que la segunda ve el pago `pendiente` que un reenvío concurrente acabó de
// confirmar mientras esta transacción esperaba el bloqueo. El reenvío bloquea la misma fila antes de insertar: o gana el
// reenvío y no se cierra, o gana el cierre y el reenvío ve la membresía `caducada` (nunca `caducada` con un pago pendiente).
//
// Una membresía `caducada` no activa nada: no toca pagos ni reservas y NO genera crédito en horas ni devolución, porque no
// se aprobó ningún pago (el ítem 14 no la extiende).
export async function cerrarMembresiasSinReenvio(tx: Pick<Transaccion, "select" | "update">, plazoDias: number): Promise<string[]> {
  const candidatas = await tx
    .select({ id: membresias.id })
    .from(membresias)
    .where(
      and(
        eq(membresias.estado, "pendiente"),
        sql`EXISTS (SELECT 1 FROM pagos p WHERE p.membresia_id = ${membresias.id} AND p.estado = 'rechazado')`,
      ),
    )
    .for("update");
  if (candidatas.length === 0) return [];

  const cerradas = await tx
    .update(membresias)
    .set({ estado: "caducada" })
    .where(
      and(
        inArray(
          membresias.id,
          candidatas.map((c) => c.id),
        ),
        eq(membresias.estado, "pendiente"),
        sql`NOT EXISTS (SELECT 1 FROM pagos p WHERE p.membresia_id = ${membresias.id} AND p.estado = 'pendiente')`,
        sql`NOT EXISTS (SELECT 1 FROM pagos p WHERE p.membresia_id = ${membresias.id} AND p.estado = 'rechazado' AND p.revisado_en + make_interval(days => ${plazoDias}::int) > now())`,
      ),
    )
    .returning({ id: membresias.id });
  return cerradas.map((c) => c.id);
}
