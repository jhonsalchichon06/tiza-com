import type { TipoDeServicio } from "./parametros";

// Nombres de los servicios tal como los ve el cliente (sin cifras: las duraciones y los precios los da el servidor).
export const NOMBRES_DE_SERVICIO: Record<TipoDeServicio, string> = {
  estandar: "Limpieza estándar",
  profunda: "Limpieza profunda",
  mudanza: "Limpieza de mudanza",
  paquete: "Por horas",
};
