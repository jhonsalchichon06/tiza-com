import { sql } from "drizzle-orm";
import { aFecha, aNumero, filas, type Ejecutor } from "./sql";
import { repartirCredito, type LoteParaRepartir } from "./reparto";

// Aplicar el crédito en horas al reservar (ADR 0012; design de credito-en-horas, decisión 3): bloquear los lotes vigentes del
// cliente, repartir las horas empezando por el lote que vence antes, descontarlas y dejar un uso por lote. Todo dentro de la
// transacción de la reserva, así dos reservas simultáneas del mismo cliente no usan las mismas horas.

// Lotes con horas y sin vencer (reloj de la base), bloqueados `ORDER BY id FOR UPDATE`: siempre por `id` para que el orden de
// bloqueo sea el mismo en todas las rutas (ver `transiciones.ts`). El orden por vencimiento lo pone `repartirCredito` en memoria.
export async function leerCreditoParaReservar(tx: Ejecutor, usuarioId: string): Promise<LoteParaRepartir[]> {
  const resultado = await tx.execute(sql`
    SELECT "id", "vence_en", "horas_disponibles" FROM "creditos_horas"
    WHERE "usuario_id" = ${usuarioId} AND "vence_en" > now() AND "horas_disponibles" > 0
    ORDER BY "id" FOR UPDATE`);
  return filas<{ id: string; vence_en: Date | string; horas_disponibles: string | number }>(resultado).map((f) => ({
    id: f.id,
    venceEn: aFecha(f.vence_en),
    horasDisponibles: aNumero(f.horas_disponibles),
  }));
}

export type EstadoDeUsoNuevo = "reservado" | "consumido";

// Horas que esos lotes pueden cubrir de `horasMaximas` (nunca más que lo disponible ni que lo pedido).
export function horasCubiertas(lotes: LoteParaRepartir[], horasMaximas: number): number {
  const { sobrante } = repartirCredito(lotes, horasMaximas);
  return Math.max(0, horasMaximas - sobrante);
}

// Error de invariante: el crédito que se creía disponible (leído con bloqueo en esta misma transacción) ya no lo estaba.
export class ErrorDeInvariante extends Error {}

export type ResultadoDeToma = { tomadas: number; faltante: number };

// Descuenta `horas` de los lotes leídos (el que vence antes primero) y registra un uso por lote con el `estado` dado
// (`reservado` si la reserva nace `pendiente`, `consumido` si nace `confirmada`). Por cada lote: `UPDATE ... WHERE
// horas_disponibles >= $h`; si no afecta ninguna fila lanza `ErrorDeInvariante` y la transacción se deshace.
// Con `permitirFaltante` toma lo que haya y devuelve cuánto faltó (nuevo horario tras una aprobación tardía, decisión 4);
// sin él, que los lotes no alcancen es un error de invariante.
export async function tomarCredito(
  tx: Ejecutor,
  { lotes, reservaId, horas, estado, permitirFaltante = false }: { lotes: LoteParaRepartir[]; reservaId: string; horas: number; estado: EstadoDeUsoNuevo; permitirFaltante?: boolean },
): Promise<ResultadoDeToma> {
  if (horas <= 0) return { tomadas: 0, faltante: 0 };
  const { reparto, sobrante } = repartirCredito(lotes, horas);
  if (sobrante > 0 && !permitirFaltante) throw new ErrorDeInvariante(`El crédito no alcanza: faltan ${sobrante} horas`);
  for (const { creditoId, horas: h } of reparto) {
    const descontado = filas(
      await tx.execute(sql`
        UPDATE "creditos_horas" SET "horas_disponibles" = "horas_disponibles" - ${h}
        WHERE "id" = ${creditoId} AND "horas_disponibles" >= ${h}
        RETURNING "id"`),
    );
    if (descontado.length === 0) throw new ErrorDeInvariante(`El lote ${creditoId} ya no tiene ${h} horas disponibles`);
    await tx.execute(sql`
      INSERT INTO "usos_credito" ("credito_id", "reserva_destino_id", "horas", "estado")
      VALUES (${creditoId}, ${reservaId}, ${h}, ${estado})`);
  }
  return { tomadas: horas - sobrante, faltante: sobrante };
}
