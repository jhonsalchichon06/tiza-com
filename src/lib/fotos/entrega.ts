import { eq } from "drizzle-orm";
import { db } from "@/db/cliente";
import { fotosServicio, reservas } from "@/db/esquema";
import type { BaseDatos } from "../agenda/expirar";
import { errorOriginal } from "../agenda/errores-bd";
import { ErrorApi } from "../errores";
import type { RecursoEntregable } from "../imagenes/entrega";
import { conReintento } from "../reintento";
import type { Usuario } from "../sesion";
import { esUuid } from "../uuid";

export type FotoParaEntrega = { ruta: string; reservaId: string; usuarioId: string };

// Con la base inyectable para probarla contra la rama de pruebas de Neon.
export async function buscarFoto(base: Pick<BaseDatos, "select">, id: string): Promise<FotoParaEntrega | null> {
  const [foto] = await base
    .select({ ruta: fotosServicio.ruta, reservaId: fotosServicio.reservaId, usuarioId: reservas.usuarioId })
    .from(fotosServicio)
    .innerJoin(reservas, eq(reservas.id, fotosServicio.reservaId))
    .where(eq(fotosServicio.id, id))
    .limit(1);
  return foto ?? null;
}

const buscarFotoEnBase = (id: string) => buscarFoto(db(), id);

// Resolvedor de `crearRutaEntrega` para `GET /api/fotos/:id` (patrón de `obtenerComprobante`). Devuelve null (→ 404) si el id
// no tiene formato de uuid (sin esto, un `abc` daría un error de Postgres y un 500) o si la foto no existe. Autoriza a un
// administrador, o al dueño de la reserva cuando además la ruta guardada está en la carpeta de ESA reserva: dos comprobaciones,
// para que un dato corrupto o un error futuro en una no abra el acceso. Un cliente ajeno recibe el mismo 404 que un id inexistente.
export async function obtenerFoto(
  id: string,
  _usuario: Usuario,
  buscar: (id: string) => Promise<FotoParaEntrega | null> = buscarFotoEnBase,
): Promise<RecursoEntregable | null> {
  if (!esUuid(id)) return null;
  const foto = await conReintento(async () => {
    try {
      return await buscar(id);
    } catch (error) {
      throw error instanceof ErrorApi ? error : errorOriginal(error);
    }
  });
  if (!foto?.ruta) return null;
  return {
    ruta: foto.ruta,
    autorizar: (usuario, ruta) =>
      usuario.rol === "admin" || (usuario.id === foto.usuarioId && ruta.startsWith(`fotos/${foto.reservaId}/`)),
  };
}
