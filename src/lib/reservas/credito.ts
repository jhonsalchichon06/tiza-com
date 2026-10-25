import { leerSaldoVigente } from "../creditos/saldo";
import type { Ejecutor } from "../creditos/sql";

// Crédito en horas para COTIZAR (ADR 0012): el saldo vigente del cliente, sin bloquear nada. `GET /api/cotizacion` lo pasa como
// `creditoHoras` a `calcularServicio`, que ya lo acota por las horas a cobrar (y aplica antes las horas gratis).
//
// La RESERVA no usa esta función: dentro de su transacción bloquea los lotes con `leerCreditoParaReservar` y los descuenta con
// `tomarCredito` (`src/lib/creditos/aplicar.ts`). Si entre la cotización y la confirmación el crédito cambia (venció, se usó
// en otra reserva), prevalece el cálculo del servidor (design de credito-en-horas, decisión 3).
export async function creditoParaReserva(lector: Ejecutor, usuarioId: string, _horasMaximas: number): Promise<number> {
  void _horasMaximas;
  return leerSaldoVigente(lector, usuarioId);
}

export type CreditoParaReserva = typeof creditoParaReserva;
