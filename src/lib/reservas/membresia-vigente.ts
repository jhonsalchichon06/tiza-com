import { and, desc, eq, sql } from "drizzle-orm";
import { membresias } from "@/db/esquema";
import type { Transaccion } from "../agenda/expirar";

type Lector = Pick<Transaccion, "select">;

export type MembresiaQueAutoriza = { id: string; inicio: Date; fin: Date; vigente: boolean };

// La membresía `activa` del cliente que cubre más tiempo (la de `fin` más lejano): con una renovación (#15) puede haber
// dos, y la que llega más lejos es la que permite el mayor rango de fechas (design de reservar-como-miembro-activo,
// decisión 2). `vigente` se calcula en la base (`fin > now()`), no con el reloj del servidor. Devuelve null si el cliente
// no tiene ninguna `activa`; una `pendiente` o `caducada` no autoriza nada.
export async function leerMembresiaQueAutoriza(lector: Lector, usuarioId: string): Promise<MembresiaQueAutoriza | null> {
  const [fila] = await lector
    .select({
      id: membresias.id,
      inicio: membresias.inicio,
      fin: membresias.fin,
      vigente: sql<boolean>`${membresias.fin} > now()`,
    })
    .from(membresias)
    .where(and(eq(membresias.usuarioId, usuarioId), eq(membresias.estado, "activa")))
    .orderBy(desc(membresias.fin))
    .limit(1);
  if (!fila || !fila.inicio || !fila.fin) return null;
  return { id: fila.id, inicio: fila.inicio, fin: fila.fin, vigente: fila.vigente === true };
}

// ¿Tiene alguna membresía `activa`, vigente o vencida? Decide la rama de `POST /api/reservas`: quien ya fue miembro y
// tiene la membresía vencida sigue siendo miembro (recibe el 422 de renovar), no el flujo de la primera membresía.
export async function tieneMembresiaActiva(lector: Lector, usuarioId: string): Promise<boolean> {
  const filas = await lector
    .select({ id: membresias.id })
    .from(membresias)
    .where(and(eq(membresias.usuarioId, usuarioId), eq(membresias.estado, "activa")))
    .limit(1);
  return filas.length > 0;
}
