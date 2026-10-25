import { ErrorImagen, subirImagen, validarArchivoOriginal } from "@/lib/imagenes/cliente";
import { MENSAJE_SIN_CONEXION } from "./api-cliente";

export type ResultadoDeSubida = { ok: true; ruta: string } | { ok: false; mensaje: string };

type Subir = (archivo: File, opciones: { destino: { tipo: "comprobante"; usuarioId: string } }) => Promise<string>;

// Valida el archivo y lo sube a la tienda privada (ADR 0010). Un PDF o una imagen de más de 5 MB se rechaza antes
// de subir nada, con el mensaje de `validarArchivoOriginal`; así no se crea ningún pago.
export async function subirComprobante(archivo: File, usuarioId: string, subir: Subir = subirImagen): Promise<ResultadoDeSubida> {
  try {
    validarArchivoOriginal(archivo);
    const ruta = await subir(archivo, { destino: { tipo: "comprobante", usuarioId } });
    return { ok: true, ruta };
  } catch (error) {
    return { ok: false, mensaje: error instanceof ErrorImagen ? error.message : MENSAJE_SIN_CONEXION };
  }
}
