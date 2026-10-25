import type { Configuracion } from "../configuracion";

// Plan de la renovación: ÚNICO punto que dice cuántos meses dura y cuánto cuesta (renovacion-del-mes-4, decisión 1).
// Decisión provisional del usuario, pendiente de confirmar por el negocio (PRD, REVISAR): otro período de
// `membresia_meses` meses en un solo pago de `membresia_precio_mensual` × `membresia_meses`, igual que la primera membresía.
// Ninguna cifra vive aquí: si el negocio cambia la respuesta se edita `configuracion` (o esta función si cambia la regla).
export type PlanDeRenovacion = { meses: number; monto: number };

export function planDeRenovacion(config: Pick<Configuracion, "membresia_meses" | "membresia_precio_mensual">): PlanDeRenovacion {
  return { meses: config.membresia_meses, monto: config.membresia_precio_mensual * config.membresia_meses };
}
