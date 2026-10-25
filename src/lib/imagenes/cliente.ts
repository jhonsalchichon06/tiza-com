// Parte del navegador: validar, reducir y subir una imagen directo a Blob (ADR 0010). Los pasos que tocan el
// navegador (decodificar, codificar, subir) se inyectan para poder probar la lógica sin DOM ni red.
import {
  EXTENSIONES_PERMITIDAS,
  MAX_BYTES_ORIGINAL,
  MAX_BYTES_SUBIDO,
  MAX_LADO_PX,
  OBJETIVO_BYTES,
  TIPOS_PERMITIDOS,
} from "./tipos";

// Error pensado para mostrarse tal cual al cliente.
export class ErrorImagen extends Error {}

export const MENSAJE_TIPO = "Solo se aceptan imágenes JPG, PNG o WebP.";
export const MENSAJE_TAMANO = "La imagen pesa más de 5 MB. Elige una más liviana.";
export const MENSAJE_OTRA_IMAGEN = "No pudimos reducir esa imagen. Elige otra más liviana.";
export const MENSAJE_SUBIDA = "No pudimos subir la imagen. Revisa tu internet e inténtalo de nuevo.";

type ArchivoBasico = { name: string; type: string; size: number };

// El tipo se decide por el MIME y por la extensión: deben cumplirse los dos.
export function validarArchivoOriginal(archivo: ArchivoBasico): void {
  const nombre = archivo.name.toLowerCase();
  const tipoOk = (TIPOS_PERMITIDOS as readonly string[]).includes(archivo.type);
  const extensionOk = EXTENSIONES_PERMITIDAS.some((e) => nombre.endsWith(e));
  if (!tipoOk || !extensionOk) throw new ErrorImagen(MENSAJE_TIPO);
  if (archivo.size > MAX_BYTES_ORIGINAL) throw new ErrorImagen(MENSAJE_TAMANO);
}

// Reduce para que el lado mayor no pase de `max`, conservando la proporción y sin ampliar.
export function calcularDimensiones(ancho: number, alto: number, max = MAX_LADO_PX): { ancho: number; alto: number } {
  const mayor = Math.max(ancho, alto);
  if (mayor <= max) return { ancho, alto };
  const factor = max / mayor;
  return { ancho: Math.max(1, Math.round(ancho * factor)), alto: Math.max(1, Math.round(alto * factor)) };
}

export type ImagenDecodificada = { ancho: number; alto: number; origen: unknown; cerrar?: () => void };

export type EntornoDeImagen = {
  decodificar: (archivo: Blob) => Promise<ImagenDecodificada>;
  // Puede devolver un tipo distinto del pedido (algunos navegadores no codifican WebP y devuelven PNG), o null.
  codificar: (imagen: ImagenDecodificada, ancho: number, alto: number, tipo: string, calidad: number) => Promise<Blob | null>;
};

// Orientación EXIF aplicada al decodificar; OffscreenCanvas si existe y <canvas> si no.
export const entornoDelNavegador: EntornoDeImagen = {
  async decodificar(archivo) {
    const bitmap = await createImageBitmap(archivo, { imageOrientation: "from-image" });
    return { ancho: bitmap.width, alto: bitmap.height, origen: bitmap, cerrar: () => bitmap.close() };
  },
  async codificar(imagen, ancho, alto, tipo, calidad) {
    const origen = imagen.origen as ImageBitmap;
    if (typeof OffscreenCanvas !== "undefined") {
      const lienzo = new OffscreenCanvas(ancho, alto);
      lienzo.getContext("2d")?.drawImage(origen, 0, 0, ancho, alto);
      return lienzo.convertToBlob({ type: tipo, quality: calidad });
    }
    const lienzo = document.createElement("canvas");
    lienzo.width = ancho;
    lienzo.height = alto;
    lienzo.getContext("2d")?.drawImage(origen, 0, 0, ancho, alto);
    return new Promise<Blob | null>((resolver) => lienzo.toBlob(resolver, tipo, calidad));
  },
};

const CALIDADES = [0.85, 0.75, 0.65, 0.55, 0.5];

// Reduce a 2000 px y vuelve a codificar apuntando a 1 MB. Si no se puede, sube el original solo si pesa ≤ 4 MB.
export async function prepararImagen(archivo: File, entorno: EntornoDeImagen = entornoDelNavegador): Promise<Blob> {
  let imagen: ImagenDecodificada | undefined;
  try {
    imagen = await entorno.decodificar(archivo);
    const { ancho, alto } = calcularDimensiones(imagen.ancho, imagen.alto);
    let mejor: Blob | null = null;

    for (const tipo of ["image/webp", "image/jpeg"]) {
      let saleDelTipo = false;
      for (const calidad of CALIDADES) {
        const blob = await entorno.codificar(imagen, ancho, alto, tipo, calidad);
        if (!blob || blob.type !== tipo) {
          saleDelTipo = true; // el navegador no codifica este tipo: probar el siguiente
          break;
        }
        if (!mejor || blob.size < mejor.size) mejor = blob;
        if (blob.size <= OBJETIVO_BYTES) break;
      }
      if (!saleDelTipo && mejor) break; // este tipo funcionó: no hace falta probar el otro
    }

    if (!mejor) throw new Error("el navegador no pudo codificar la imagen");
    if (mejor.size > MAX_BYTES_SUBIDO) throw new ErrorImagen(MENSAJE_OTRA_IMAGEN);
    return mejor;
  } catch (error) {
    if (error instanceof ErrorImagen) throw error;
    if (archivo.size <= MAX_BYTES_SUBIDO) return archivo;
    throw new ErrorImagen(MENSAJE_OTRA_IMAGEN);
  } finally {
    imagen?.cerrar?.();
  }
}

const EXTENSION_DE_TIPO: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

export type DestinoDeSubida =
  | { tipo: "comprobante"; usuarioId: string }
  | { tipo: "foto"; reservaId: string };

export type OpcionesDeSubida = { destino: DestinoDeSubida; onProgreso?: (porcentaje: number) => void };

export type Subidor = (
  ruta: string,
  cuerpo: Blob,
  opciones: { tipo: string; clientPayload: string; onProgreso?: (porcentaje: number) => void },
) => Promise<{ pathname: string }>;

// Sube con el SDK de Blob. Se importa al usarlo para no cargarlo donde no se sube nada.
const subidorDeBlob: Subidor = async (ruta, cuerpo, { tipo, clientPayload, onProgreso }) => {
  const { upload } = await import("@vercel/blob/client");
  return upload(ruta, cuerpo, {
    access: "private",
    handleUploadUrl: "/api/subidas",
    contentType: tipo,
    clientPayload,
    onUploadProgress: ({ percentage }) => onProgreso?.(percentage),
  });
};

// Valida, reduce, pide el token a /api/subidas y sube. Devuelve la ruta final en Blob, que la ruta de negocio
// verificará. Si algo falla no queda nada registrado: la ruta de negocio solo recibe una ruta cuando esto termina bien.
export async function subirImagen(
  archivo: File,
  { destino, onProgreso }: OpcionesDeSubida,
  dependencias: { entorno?: EntornoDeImagen; subir?: Subidor } = {},
): Promise<string> {
  validarArchivoOriginal(archivo);
  const listo = await prepararImagen(archivo, dependencias.entorno);
  const extension = EXTENSION_DE_TIPO[listo.type] ?? EXTENSION_DE_TIPO[archivo.type] ?? "jpg";
  const carpeta = destino.tipo === "comprobante" ? `comprobantes/${destino.usuarioId}/` : `fotos/${destino.reservaId}/`;
  const ruta = `${carpeta}${Date.now()}.${extension}`;

  try {
    const resultado = await (dependencias.subir ?? subidorDeBlob)(ruta, listo, {
      tipo: listo.type || archivo.type,
      clientPayload: JSON.stringify({ tipo: destino.tipo }),
      onProgreso,
    });
    return resultado.pathname;
  } catch {
    throw new ErrorImagen(MENSAJE_SUBIDA);
  }
}
