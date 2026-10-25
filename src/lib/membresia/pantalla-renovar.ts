import { formatearSoles } from "../soles";
import { textoMeses, type Renovacion } from "./renovacion";

// Qué muestra /cuenta/renovar (renovacion-del-mes-4, decisión 8): el formulario solo al cliente en estado `vencida`; en
// cualquier otro estado el perfil. El monto y la duración vienen del servidor (`planDeRenovacion` dentro del estado).
export type PantallaDeRenovar = { tipo: "redirigir"; a: "/cuenta" } | { tipo: "formulario"; monto: string; duracion: string };

export function pantallaDeRenovar(renovacion: Renovacion): PantallaDeRenovar {
  if (renovacion.estado !== "vencida") return { tipo: "redirigir", a: "/cuenta" };
  return { tipo: "formulario", monto: formatearSoles(renovacion.plan.monto), duracion: textoMeses(renovacion.plan.meses) };
}
