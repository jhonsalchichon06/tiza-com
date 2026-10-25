import { ErrorApi, manejar } from "../errores";
import { requerirSesion, type Usuario } from "../sesion";
import { almacenDeBlob, type AlmacenDeImagenes } from "./almacen";
import type { UsuarioImagen } from "./rutas";
import { TIPOS_PERMITIDOS } from "./tipos";

export type Autorizar = (usuario: UsuarioImagen, ruta: string) => boolean | Promise<boolean>;

// Un comprobante lo ve su dueño (la carpeta `comprobantes/{usuarioId}/`) y un administrador. Se decide con la
// sesión y la ruta, sin consultar la base. Sirve a #9 y #11, cuyas tablas de pagos todavía no existen.
export const autorizarComprobantePorCarpeta: Autorizar = (usuario, ruta) =>
  usuario.rol === "admin" || ruta.startsWith(`comprobantes/${usuario.id}/`);

// Lee el archivo en el servidor y lo devuelve en el cuerpo (ADR 0010). Nunca redirige a una URL de Blob.
// Sin permiso responde 404 y ni siquiera lee Blob: no se confirma que el archivo exista.
export async function entregarImagen(
  { ruta, usuario, autorizar }: { ruta: string; usuario: UsuarioImagen; autorizar: Autorizar },
  almacen: Pick<AlmacenDeImagenes, "leer"> = almacenDeBlob,
): Promise<Response> {
  if (!(await autorizar(usuario, ruta))) throw ErrorApi.noEncontrado();
  const archivo = await almacen.leer(ruta);
  if (!archivo) throw ErrorApi.noEncontrado();

  // Si Blob declarara algo que no es una imagen permitida, no se muestra en línea.
  const esImagen = (TIPOS_PERMITIDOS as readonly string[]).includes(archivo.tipo);
  return new Response(archivo.cuerpo, {
    status: 200,
    headers: {
      "Content-Type": esImagen ? archivo.tipo : "application/octet-stream",
      "Content-Length": String(archivo.tamano),
      "Content-Disposition": esImagen ? "inline" : "attachment",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

export type RecursoEntregable = { ruta: string; autorizar: Autorizar };

type Dependencias = {
  // Busca el recurso por id (el pago, la foto) y dice qué ruta tiene y quién puede verlo. `null` si no existe.
  obtenerRecurso: (id: string, usuario: Usuario) => Promise<RecursoEntregable | null>;
  sesion?: (cabeceras: Headers) => Promise<Usuario>;
  almacen?: Pick<AlmacenDeImagenes, "leer">;
};

// Fábrica del GET de entrega. Los ítems #9, #11 y #17 la instancian con su resolvedor:
//   export const GET = crearRutaEntrega({ obtenerRecurso: ... });
export function crearRutaEntrega({ obtenerRecurso, sesion = (c) => requerirSesion(c), almacen = almacenDeBlob }: Dependencias) {
  return manejar(async (req: Request, contexto: { params: Promise<{ id: string }> }) => {
    const usuario = await sesion(req.headers);
    const { id } = await contexto.params;
    const recurso = await obtenerRecurso(id, usuario);
    if (!recurso) throw ErrorApi.noEncontrado();
    return entregarImagen({ ruta: recurso.ruta, usuario, autorizar: recurso.autorizar }, almacen);
  });
}
