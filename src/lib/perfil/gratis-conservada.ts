import { and, desc, eq } from "drizzle-orm";
import { reservas } from "@/db/esquema";
import type { BaseDatos } from "../agenda/expirar";
import type { Distrito } from "../distritos";
import { decidirLimpiezaGratis } from "../reservas/gratis";
import type { MembresiaDelPerfil } from "./membresia";

// ¿Sigue disponible la limpieza gratis que el cliente canceló? (ADR 0008: la primera limpieza cancelada no pierde su
// beneficio.) No hay un campo que mantener: se decide con la MISMA regla que aplica la reserva (`decidirLimpiezaGratis`:
// el cliente no tiene otra reserva viva o realizada y el hogar no recibió la limpieza de otra cuenta), usando la clave del
// hogar de la reserva cancelada, porque la dirección de la siguiente reserva todavía no existe. Solo lectura.
export async function limpiezaGratisConservada(
  base: Pick<BaseDatos, "select">,
  usuarioId: string,
  membresia: MembresiaDelPerfil,
): Promise<boolean> {
  if (membresia.estado !== "activa") return false;

  const [cancelada] = await base
    .select({
      distrito: reservas.distrito,
      direccionNormalizada: reservas.direccionNormalizada,
      departamentoNormalizado: reservas.departamentoNormalizado,
    })
    .from(reservas)
    .where(and(eq(reservas.usuarioId, usuarioId), eq(reservas.estado, "cancelada"), eq(reservas.primeraGratis, true)))
    .orderBy(desc(reservas.actualizadaEn))
    .limit(1);
  if (!cancelada) return false;

  return decidirLimpiezaGratis(base, usuarioId, {
    distrito: cancelada.distrito as Distrito,
    direccionNormalizada: cancelada.direccionNormalizada,
    departamentoNormalizado: cancelada.departamentoNormalizado,
  });
}
