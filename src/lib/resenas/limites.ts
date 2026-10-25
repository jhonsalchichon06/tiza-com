// Límites del comentario de una reseña. SUPUESTO (design de `resenas`, decisión 2): el PRD pide "estrellas y comentario" sin
// largos; 10 evita un "ok" vacío y 500 cabe en una tarjeta de la landing. Son límites de validación de entrada, no precios
// ni plazos, así que viven en código y no en `configuracion`. Se cuentan caracteres (un emoji cuenta como uno).
// Archivo sin dependencias: lo importan también los componentes del navegador.
export const COMENTARIO_MIN = 10;
export const COMENTARIO_MAX = 500;

export const largoDelComentario = (texto: string) => Array.from(texto).length;
