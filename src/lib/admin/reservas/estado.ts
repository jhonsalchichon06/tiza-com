import { sql } from "drizzle-orm";
import { reservas } from "@/db/esquema";

export type EstadoEfectivo = "pendiente" | "confirmada" | "completada" | "cancelada" | "expirada";

// Los valores que acepta el filtro `estado` del listado. `por_completar` no es un estado: son las `confirmada` cuyo
// servicio ya empezó (el trabajo atrasado del administrador).
export const FILTROS_DE_ESTADO = ["pendiente", "confirmada", "completada", "cancelada", "expirada", "por_completar"] as const;
export type FiltroDeEstado = (typeof FILTROS_DE_ESTADO)[number];

// ÚNICA definición del estado que ve el administrador (ADR 0009: "debe centralizarse"). Una reserva `pendiente` cuya espera
// ya venció se muestra `expirada` aunque nadie la haya marcado todavía, con el reloj de la base. El listado, el filtro por
// estado y los indicadores `puede_*` la usan; ninguna consulta repite la condición. Para filtrar las reservas "vivas" se
// usa `reservaActiva` (src/db/reservas-activas.ts), que expresa la misma regla.
//
// Por qué no una vista SQL: agregaría una migración que este ítem no necesita (design de gestion-de-reservas-y-apoyo,
// decisión 2). La pasada de expiración (`ejecutarPasadaDeExpiracion`) persiste las marcas, pero el estado mostrado no
// depende de que haya corrido.
export const estadoEfectivoSql = sql<EstadoEfectivo>`(CASE WHEN ${reservas.estado} = 'pendiente' AND ${reservas.expiraEn} <= now() THEN 'expirada' ELSE ${reservas.estado}::text END)`;

// Una reserva viva bloquea cupo: `confirmada` o `pendiente` vigente. Con el estado efectivo ya calculado.
export const esViva = (estado: EstadoEfectivo): boolean => estado === "confirmada" || estado === "pendiente";

// Nombre del estado para los mensajes de error («Esa reserva está cancelada…»).
export const NOMBRE_DEL_ESTADO: Record<EstadoEfectivo, string> = {
  pendiente: "en espera del pago",
  confirmada: "confirmada",
  completada: "completada",
  cancelada: "cancelada",
  expirada: "expirada",
};
