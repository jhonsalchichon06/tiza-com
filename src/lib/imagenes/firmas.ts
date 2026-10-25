import type { TipoImagen } from "./tipos";

const empieza = (bytes: Uint8Array, firma: number[], desde = 0) =>
  bytes.length >= desde + firma.length && firma.every((b, i) => bytes[desde + i] === b);

// Decide el tipo por los bytes iniciales, sin fiarse del Content-Type ni de la extensión (que declara el navegador).
export function detectarTipoImagen(bytes: Uint8Array): TipoImagen | null {
  if (empieza(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (empieza(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // WebP: "RIFF" + 4 bytes de tamaño + "WEBP".
  if (empieza(bytes, [0x52, 0x49, 0x46, 0x46]) && empieza(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

// Cuántos bytes iniciales hacen falta para reconocer cualquiera de los tres tipos.
export const BYTES_DE_FIRMA = 12;
