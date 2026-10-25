import { ErrorApi } from "../errores";
import type { AlmacenDeImagenes } from "./almacen";
import { almacenDeBlob } from "./almacen";
import { BYTES_DE_FIRMA, detectarTipoImagen } from "./firmas";
import { validarRutaSubida, type UsuarioImagen } from "./rutas";
import { MAX_BYTES_SUBIDO, type TipoImagen } from "./tipos";

export type ImagenVerificada = { ruta: string; tipo: TipoImagen; tamano: number };

// Las rutas de negocio (#9, #11, #17) la llaman ANTES de abrir su transacción y guardan solo la ruta devuelta.
// No crea filas: si algo falla lanza el error y la ruta de negocio no crea ni el pago ni la reserva.
// Comprueba la carpeta (la misma regla del token), que el archivo existe, que pesa ≤ 4 MB y que sus bytes
// iniciales son de una imagen JPG, PNG o WebP: no se fía del tipo que declara el navegador.
export async function verificarImagenSubida(
  { ruta, usuario }: { ruta: unknown; usuario: UsuarioImagen },
  almacen: Pick<AlmacenDeImagenes, "metadatos" | "leerInicio"> = almacenDeBlob,
): Promise<ImagenVerificada> {
  const validada = validarRutaSubida({ ruta, usuario });
  const rutaFinal = `${validada.carpeta}${validada.nombre}`;

  const noExiste = () => ErrorApi.noEncontrado("No encontramos el archivo que subiste. Súbelo de nuevo.");
  const metadatos = await almacen.metadatos(rutaFinal);
  if (!metadatos) throw noExiste();
  if (metadatos.tamano > MAX_BYTES_SUBIDO) throw ErrorApi.invalido("La imagen pesa más de 4 MB. Elige una más liviana.");

  const inicio = await almacen.leerInicio(rutaFinal, BYTES_DE_FIRMA);
  if (!inicio) throw noExiste();
  const tipo = detectarTipoImagen(inicio);
  if (!tipo) throw ErrorApi.invalido("El archivo no es una imagen JPG, PNG o WebP.");

  return { ruta: rutaFinal, tipo, tamano: metadatos.tamano };
}
