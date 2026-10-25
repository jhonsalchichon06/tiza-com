// Textos del portal de pagos. Las fechas llegan del servidor con la hora de Lima escrita en el texto: se leen tal cual,
// sin pasar por el reloj del dispositivo.

export const CONCEPTOS: Record<string, string> = {
  membresia: "Membresía",
  reserva: "Limpieza",
  membresia_y_reserva: "Membresía y limpieza",
};

export const METODOS: Record<string, string> = { yape: "Yape", transferencia: "Transferencia", credito: "Crédito en horas" };

export const ESTADOS_DE_RESERVA: Record<string, string> = {
  pendiente: "En espera",
  confirmada: "Confirmada",
  expirada: "Expirada",
  cancelada: "Cancelada",
  completada: "Completada",
};

export const NIVELES: Record<string, string> = {
  misma_direccion: "Misma dirección",
  otro_departamento: "Mismo edificio, otro departamento",
  calle_parecida: "Calle parecida",
};

export const TIPOS_DE_SERVICIO: Record<string, string> = {
  estandar: "Limpieza estándar",
  profunda: "Limpieza profunda",
  mudanza: "Limpieza de mudanza",
  paquete: "Paquete por horas",
};

// "2026-11-03T10:00:00-05:00" → "03/11/2026 10:00"
export function fechaYHora(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio} ${iso.slice(11, 16)}`;
}
