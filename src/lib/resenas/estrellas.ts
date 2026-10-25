// Estrellas de una reseña como texto: "★★★★☆" para mostrar y "4 de 5 estrellas" para `aria-label` (lectores de pantalla).
export const MAXIMO_ESTRELLAS = 5;

export function estrellasEnTexto(estrellas: number): string {
  const llenas = Math.max(0, Math.min(MAXIMO_ESTRELLAS, Math.round(estrellas)));
  return "★".repeat(llenas) + "☆".repeat(MAXIMO_ESTRELLAS - llenas);
}

export const etiquetaDeEstrellas = (estrellas: number): string => `${estrellas} de ${MAXIMO_ESTRELLAS} estrellas`;
