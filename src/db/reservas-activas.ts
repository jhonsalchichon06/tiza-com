import { and, eq, gt, or, sql } from "drizzle-orm";
import { reservas } from "./esquema";

// Una reserva "activa" bloquea el cupo y cuenta como realmente en espera o confirmada (ADR 0009):
// `confirmada`, o `pendiente` cuyo plazo todavía no venció. Una pendiente vencida deja de contar al leer,
// aunque nadie la haya marcado `expirada` todavía.
//
// TODA lectura de agenda, perfil y administración que filtre reservas por estado debe usar este fragmento
// en vez de repetir la condición: repetirla es el riesgo que señala el ADR 0009.
export const reservaActiva = or(
  eq(reservas.estado, "confirmada"),
  and(eq(reservas.estado, "pendiente"), gt(reservas.expiraEn, sql`now()`)),
)!;

// Para la regla de la limpieza gratis (ADR 0008 y 0009): cuenta la reserva activa y también la `completada`
// (la primera limpieza ya realizada). Una `pendiente` vencida, una `cancelada` y una `expirada` no cuentan.
// Sirve igual al leer (cotización) que al escribir, sin depender de que alguien haya marcado las vencidas.
export const reservaQueCuentaParaGratis = or(reservaActiva, eq(reservas.estado, "completada"))!;
