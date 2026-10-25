import { ErrorApi } from "../errores";
import { EXTENSIONES_PERMITIDAS } from "./tipos";

export type UsuarioImagen = { id: string; rol: "cliente" | "admin" };
export type TipoCarpeta = "comprobante" | "foto";

const FORMATO_RESERVA_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_LARGO_NOMBRE = 200;
const CARACTERES_DE_CONTROL = /[\u0000-\u001f\u007f]/;

// La carpeta sale de la sesión, nunca de lo que envía el navegador (ADR 0010).
// Comprobantes: la del propio usuario. Fotos del servicio: solo un administrador, por reserva.
export function carpetaPermitida(usuario: UsuarioImagen, tipo: TipoCarpeta, reservaId?: string): string {
  if (tipo === "comprobante") return `comprobantes/${usuario.id}/`;
  if (usuario.rol !== "admin") throw ErrorApi.sinPermiso();
  if (!reservaId || !FORMATO_RESERVA_ID.test(reservaId)) throw ErrorApi.invalido("La reserva de las fotos no es válida.");
  return `fotos/${reservaId}/`;
}

export type RutaValidada = { tipo: TipoCarpeta; carpeta: string; nombre: string; reservaId?: string };

// Valida una ruta de Blob contra la carpeta que le corresponde a ese usuario. La usan el token de subida y la
// verificación del archivo, así la regla vive una sola vez.
export function validarRutaSubida({ ruta, usuario }: { ruta: unknown; usuario: UsuarioImagen }): RutaValidada {
  const invalida = () => ErrorApi.invalido("La ruta del archivo no es válida.");
  if (typeof ruta !== "string" || ruta === "") throw invalida();

  const [raiz, segundo] = ruta.split("/");
  let tipo: TipoCarpeta;
  let reservaId: string | undefined;
  let carpeta: string;

  if (raiz === "comprobantes") {
    tipo = "comprobante";
    carpeta = carpetaPermitida(usuario, "comprobante");
  } else if (raiz === "fotos") {
    tipo = "foto";
    reservaId = segundo;
    carpeta = carpetaPermitida(usuario, "foto", reservaId);
  } else {
    throw invalida();
  }

  if (!ruta.startsWith(carpeta)) {
    throw ErrorApi.invalido("No puedes usar esa carpeta.");
  }
  // Un solo segmento de nombre dentro de la carpeta: sin subcarpetas ni separadores.
  const nombre = ruta.slice(carpeta.length);
  if (nombre === "" || nombre.includes("/") || nombre.includes("\\") || nombre.includes("..") || CARACTERES_DE_CONTROL.test(nombre)) {
    throw invalida();
  }
  if (nombre.length > MAX_LARGO_NOMBRE) throw ErrorApi.invalido("El nombre del archivo es demasiado largo.");

  const minuscula = nombre.toLowerCase();
  const extension = EXTENSIONES_PERMITIDAS.find((e) => minuscula.endsWith(e));
  if (!extension || nombre.length === extension.length) {
    throw ErrorApi.invalido("Solo se aceptan imágenes JPG, PNG o WebP.");
  }

  return { tipo, carpeta, nombre, reservaId };
}
