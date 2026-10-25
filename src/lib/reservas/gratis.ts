import { and, eq } from "drizzle-orm";
import { reservas } from "@/db/esquema";
import { reservaQueCuentaParaGratis } from "@/db/reservas-activas";
import type { ClaveHogar } from "../direccion";
import type { Transaccion } from "../agenda/expirar";

type Lector = Pick<Transaccion, "select">;

// Reglas de "esta reserva lleva las 3 horas gratis" (ADR 0008 y 0013). La condición de qué reserva cuenta vive en un
// solo fragmento (`reservaQueCuentaParaGratis`): las canceladas, las expiradas y las pendientes vencidas no cuentan,
// así que sirve igual para escribir (`crearPrimeraReserva`) que para leer (la cotización, que no marca nada).

// El cliente no tiene ninguna reserva viva o realizada.
export async function decidirPorCliente(tx: Lector, usuarioId: string): Promise<boolean> {
  const filas = await tx
    .select({ id: reservas.id })
    .from(reservas)
    .where(and(eq(reservas.usuarioId, usuarioId), reservaQueCuentaParaGratis))
    .limit(1);
  return filas.length === 0;
}

// Ninguna reserva con `primera_gratis` viva o realizada comparte la clave del hogar. Se compara la clave normalizada,
// no el texto que escribió el cliente ni las referencias. Las reservas pagadas del hogar no impiden nada.
export async function decidirPorHogar(tx: Lector, hogar: ClaveHogar): Promise<boolean> {
  const filas = await tx
    .select({ id: reservas.id })
    .from(reservas)
    .where(
      and(
        eq(reservas.primeraGratis, true),
        eq(reservas.distrito, hogar.distrito),
        eq(reservas.direccionNormalizada, hogar.direccionNormalizada),
        eq(reservas.departamentoNormalizado, hogar.departamentoNormalizado),
        reservaQueCuentaParaGratis,
      ),
    )
    .limit(1);
  return filas.length === 0;
}

// Única regla de "esta reserva lleva las horas gratis": cliente nuevo Y hogar nuevo. La clave del hogar es
// obligatoria para que #12 y #13 no puedan olvidarla.
export async function decidirLimpiezaGratis(tx: Lector, usuarioId: string, hogar: ClaveHogar): Promise<boolean> {
  return (await decidirPorCliente(tx, usuarioId)) && (await decidirPorHogar(tx, hogar));
}

export type MotivoSinGratis = "cliente" | "hogar";

// Lo mismo que `decidirLimpiezaGratis`, pero dice por qué no aplica; la cotización lo muestra. Sin hogar (todavía no
// se escribió la dirección) decide solo por el cliente. Es de solo lectura.
export async function motivoSinGratis(tx: Lector, usuarioId: string, hogar: ClaveHogar | null): Promise<MotivoSinGratis | null> {
  if (!(await decidirPorCliente(tx, usuarioId))) return "cliente";
  if (hogar && !(await decidirPorHogar(tx, hogar))) return "hogar";
  return null;
}
