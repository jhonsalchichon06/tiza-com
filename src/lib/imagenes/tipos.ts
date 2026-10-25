// Constantes de las imágenes (ADR 0010). Los límites de tamaño son del negocio y del plan de Vercel, no de `configuracion`.

export const TIPOS_PERMITIDOS = ["image/jpeg", "image/png", "image/webp"] as const;
export type TipoImagen = (typeof TIPOS_PERMITIDOS)[number];

export const EXTENSIONES_PERMITIDAS = [".jpg", ".jpeg", ".png", ".webp"] as const;

const MB = 1024 * 1024;
export const MAX_BYTES_ORIGINAL = 5 * MB; // lo que el cliente puede elegir (PRD)
export const MAX_BYTES_SUBIDO = 4 * MB; // lo que se sube y se entrega: cabe en el límite de 4,5 MB de las funciones
export const OBJETIVO_BYTES = 1 * MB; // a lo que apunta la compresión
export const MAX_LADO_PX = 2000;

export const HORAS_ANTES_DE_BORRAR_HUERFANOS = 24;
