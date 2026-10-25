import { and, desc, eq, inArray } from "drizzle-orm";
import { reservas } from "@/db/esquema";
import type { BaseDatos } from "../agenda/expirar";
import { pagosConHorarioPendiente, type PagoConHorarioPendiente } from "../pagos/horario-pendiente";

// Pagos aprobados por los que el cliente debe elegir un nuevo día y hora ("Elige un nuevo día y hora").
//
// Es `pagosConHorarioPendiente` (ítem 11) menos los pagos cuya reserva más reciente fue `cancelada` por el cliente
// (decisión 11 de perfil-reservas-y-membresia): lo pagado de una cancelación del cliente va a crédito en horas (ADR
// 0012, ítem 14) y no se reutiliza para otro horario; si no, el cliente cobraría dos veces (crédito y reuso). La reuso
// del MISMO pago vale solo para la expiración, la aprobación tardía y la cancelación del administrador.
// El ítem 13 usa este mismo filtro al crear la reserva con el pago aprobado.
export async function pagosParaElegirHorario(
  base: Pick<BaseDatos, "select">,
  usuarioId: string,
  pendientes: (b: Pick<BaseDatos, "select">, id: string) => Promise<PagoConHorarioPendiente[]> = pagosConHorarioPendiente,
): Promise<PagoConHorarioPendiente[]> {
  const pagos = await pendientes(base, usuarioId);
  if (pagos.length === 0) return [];

  const ultimas = await base
    .select({ pagoId: reservas.pagoId, estado: reservas.estado, canceladaPor: reservas.canceladaPor })
    .from(reservas)
    .where(
      and(
        eq(reservas.usuarioId, usuarioId),
        inArray(
          reservas.pagoId,
          pagos.map((p) => p.id),
        ),
      ),
    )
    .orderBy(desc(reservas.creadaEn));

  return pagos.filter((pago) => {
    const reciente = ultimas.find((r) => r.pagoId === pago.id);
    return !(reciente && reciente.estado === "cancelada" && reciente.canceladaPor === "cliente");
  });
}
