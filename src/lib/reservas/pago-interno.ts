import { pagos } from "@/db/esquema";
import type { Transaccion } from "../agenda/expirar";

// ÚNICO lugar donde se crean pagos internos: monto 0, método `credito`, estado `aprobado`, sin comprobante ni revisor.
// Lo usa la reserva de un miembro cuando no hay nada que pagar (las 3 horas gratis o el crédito en horas cubren todo) para
// que `reservas.pago_id` siga siendo obligatorio (ADR 0008 y 0009; design de reservar-como-miembro-activo, decisión 3).
//
// El nombre del método, `credito`, también cubre las horas gratis: el enum ya existe y el CHECK
// `pagos_comprobante_si_no_credito` solo deja un pago sin comprobante con ese método. #14 reutiliza esta función para sus
// reservas pagadas por completo con crédito; no debe crear otra versión.
export async function crearPagoInterno(
  tx: Pick<Transaccion, "insert">,
  { usuarioId, concepto }: { usuarioId: string; concepto: "reserva" },
): Promise<typeof pagos.$inferSelect> {
  const [pago] = await tx
    .insert(pagos)
    .values({ usuarioId, concepto, membresiaId: null, monto: 0, metodo: "credito", comprobanteRuta: null, estado: "aprobado" })
    .returning();
  return pago;
}
