import { BlobNotFoundError, del, get, head, list } from "@vercel/blob";

export type MetadatosDeImagen = { tamano: number; tipoDeclarado: string };
export type ArchivoLeido = { cuerpo: ReadableStream<Uint8Array>; tipo: string; tamano: number };
export type ElementoListado = { ruta: string; subidoEn: Date; tamano: number };
export type PaginaListada = { elementos: ElementoListado[]; cursor?: string; hayMas: boolean };

// Lo que el resto del código necesita de Blob. Existe para poder probar la verificación, la entrega y la
// limpieza con un almacén simulado, sin red. Toda la tienda es privada (ADR 0010).
export type AlmacenDeImagenes = {
  metadatos(ruta: string): Promise<MetadatosDeImagen | null>;
  // Solo los primeros bytes (la firma del archivo): se lee un fragmento del flujo y se cancela.
  leerInicio(ruta: string, bytes: number): Promise<Uint8Array | null>;
  leer(ruta: string): Promise<ArchivoLeido | null>;
  listar(opciones: { prefijo: string; cursor?: string }): Promise<PaginaListada>;
  borrar(ruta: string): Promise<void>;
};

const PAGINA = 1000;

export const almacenDeBlob: AlmacenDeImagenes = {
  async metadatos(ruta) {
    try {
      const h = await head(ruta);
      return { tamano: h.size, tipoDeclarado: h.contentType };
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
  },

  async leerInicio(ruta, bytes) {
    const r = await get(ruta, { access: "private" });
    if (!r || r.statusCode !== 200) return null;
    const lector = r.stream.getReader();
    const partes: Uint8Array[] = [];
    let total = 0;
    try {
      while (total < bytes) {
        const { done, value } = await lector.read();
        if (done) break;
        partes.push(value);
        total += value.length;
      }
    } finally {
      await lector.cancel().catch(() => {});
    }
    const salida = new Uint8Array(Math.min(total, bytes));
    let posicion = 0;
    for (const parte of partes) {
      const resto = salida.length - posicion;
      if (resto <= 0) break;
      salida.set(parte.subarray(0, resto), posicion);
      posicion += Math.min(parte.length, resto);
    }
    return salida;
  },

  async leer(ruta) {
    const r = await get(ruta, { access: "private" });
    if (!r || r.statusCode !== 200) return null;
    return { cuerpo: r.stream, tipo: r.blob.contentType, tamano: r.blob.size };
  },

  async listar({ prefijo, cursor }) {
    const pagina = await list({ prefix: prefijo, cursor, limit: PAGINA });
    return {
      elementos: pagina.blobs.map((b) => ({ ruta: b.pathname, subidoEn: b.uploadedAt, tamano: b.size })),
      cursor: pagina.cursor,
      hayMas: pagina.hasMore,
    };
  },

  async borrar(ruta) {
    await del(ruta);
  },
};
