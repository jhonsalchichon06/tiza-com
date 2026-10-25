import { sql } from "drizzle-orm";
import { aFecha, aNumero, filas, type Ejecutor } from "./sql";

// El próximo vencimiento: el lote vigente con horas que vence primero (desempate por id) y cuántas horas le quedan.
export type ProximoVencimiento = { horas: number; venceEn: Date };

// El saldo no se guarda: es la suma de `horas_disponibles` de los lotes que no vencieron (reloj de la base, ADR 0012).
// Lectura sin bloqueo: sirve para cotizar y mostrar; la reserva bloquea los lotes por su cuenta.
async function leer(lector: Ejecutor, usuarioId: string) {
  const resultado = await lector.execute(sql`
    SELECT COALESCE(SUM("horas_disponibles"), 0) AS "saldo",
      (array_agg("vence_en" ORDER BY "vence_en", "id") FILTER (WHERE "horas_disponibles" > 0))[1] AS "proximo",
      (array_agg("horas_disponibles" ORDER BY "vence_en", "id") FILTER (WHERE "horas_disponibles" > 0))[1] AS "proximo_horas"
    FROM "creditos_horas" WHERE "usuario_id" = ${usuarioId} AND "vence_en" > now()`);
  const [fila] = filas<{ saldo: string | number; proximo: Date | string | null; proximo_horas: string | number | null }>(resultado);
  const proximoVencimiento: ProximoVencimiento | null = fila?.proximo ? { horas: aNumero(fila.proximo_horas), venceEn: aFecha(fila.proximo) } : null;
  return { horas: fila ? aNumero(fila.saldo) : 0, proximoVencimiento };
}

export async function leerSaldoVigente(lector: Ejecutor, usuarioId: string): Promise<number> {
  return (await leer(lector, usuarioId)).horas;
}

// El lote vigente que vence primero (sus horas disponibles y su fecha), o `null` si no hay crédito vigente.
export async function proximoVencimiento(lector: Ejecutor, usuarioId: string): Promise<ProximoVencimiento | null> {
  return (await leer(lector, usuarioId)).proximoVencimiento;
}

// Las dos cosas en una sola consulta (perfil y cotización).
export const leerSaldoYVencimiento = leer;
