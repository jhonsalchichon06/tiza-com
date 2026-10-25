import { asc, eq } from "drizzle-orm";
import { fotosServicio } from "@/db/esquema";
import type { BaseDatos } from "../agenda/expirar";
import { AMBIENTES, esAmbiente, etiquetaDeAmbiente, type Ambiente } from "./ambientes";

// Lo que se muestra de una foto. NUNCA incluye `ruta` ni una URL de Blob: la imagen se pide a `/api/fotos/<id>`, que decide
// el permiso (ADR 0010).
export type FotoVista = { id: string; ambiente: string; etiqueta: string };

export type GrupoDeFotos = { ambiente: Ambiente; etiqueta: string; fotos: FotoVista[] };

// Las fotos de una reserva, de la más antigua a la más reciente. Quien la llama ya comprobó que puede ver esa reserva:
// el cliente, tras cargarla con su `usuario_id` (ver `leerDetalleReserva`); el administrador, por su rol.
export async function listarFotosDeReserva(base: Pick<BaseDatos, "select">, reservaId: string): Promise<FotoVista[]> {
  const filas = await base
    .select({ id: fotosServicio.id, ambiente: fotosServicio.ambiente })
    .from(fotosServicio)
    .where(eq(fotosServicio.reservaId, reservaId))
    .orderBy(asc(fotosServicio.creadaEn), asc(fotosServicio.id));
  return (filas as { id: string; ambiente: string }[]).map((f) => ({ id: f.id, ambiente: f.ambiente, etiqueta: etiquetaDeAmbiente(f.ambiente) }));
}

// Agrupa por ambiente en el orden de AMBIENTES (no en el de subida). Un ambiente desconocido (la lista pudo cambiar)
// cae en «otro». Solo devuelve grupos con fotos.
export function agruparPorAmbiente(fotos: FotoVista[]): GrupoDeFotos[] {
  const grupos = new Map<Ambiente, FotoVista[]>();
  for (const foto of fotos) {
    const ambiente: Ambiente = esAmbiente(foto.ambiente) ? foto.ambiente : "otro";
    grupos.set(ambiente, [...(grupos.get(ambiente) ?? []), foto]);
  }
  return AMBIENTES.filter((a) => grupos.has(a)).map((a) => ({ ambiente: a, etiqueta: etiquetaDeAmbiente(a), fotos: grupos.get(a)! }));
}
