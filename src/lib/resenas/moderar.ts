import { createHash } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/cliente";
import { reservas, resenas, usuarios } from "@/db/esquema";
import { transaccionDeEscritura, type BaseDatos } from "../agenda/expirar";
import { isoConZona } from "../agenda/horario";
import { ErrorApi } from "../errores";
import { esUuid } from "../uuid";
import type { EstadoResena } from "./textos";

export const LIMITE_COLA = 100;
export const MENSAJE_RESENA_NO_ENCONTRADA = "No encontramos esa reseña.";

export const MENSAJE_RESENA_CAMBIO = "El cliente cambió su reseña mientras la revisabas. Revísala de nuevo.";

// Huella de lo que el administrador VE (estrellas y comentario). La cola la entrega con cada reseña y, al decidir, se compara con
// la fila ya bloqueada: si el cliente la editó entre tanto, la decisión recibe 409 y no se publica un texto que no se leyó.
export const revisionDe = (estrellas: number, comentario: string): string => createHash("md5").update(`${estrellas}:${comentario}`).digest("hex");

export type ResenaPendiente = {
  id: string;
  // Huella de lo que se muestra; la pantalla la devuelve al aprobar o rechazar.
  revision: string;
  estrellas: number;
  comentario: string;
  cliente: string;
  distrito: string;
  inicio: string;
  creada_en: string;
};

// Cola del administrador: las pendientes, de la más antigua a la más reciente (para no dejar a nadie esperando), con el nombre
// completo, el distrito y la fecha del servicio para reconocer la limpieza. Máximo 100 (volumen esperado muy inferior).
// Solo la ve el administrador: las rutas y la página exigen el rol antes de llamar aquí.
export async function listarPendientes(base: Pick<BaseDatos, "select">, zona: string): Promise<ResenaPendiente[]> {
  const filas = await base
    .select({
      id: resenas.id,
      estrellas: resenas.estrellas,
      comentario: resenas.comentario,
      cliente: usuarios.name,
      distrito: reservas.distrito,
      inicio: reservas.inicio,
      creadaEn: resenas.creadaEn,
    })
    .from(resenas)
    .innerJoin(reservas, eq(resenas.reservaId, reservas.id))
    .innerJoin(usuarios, eq(reservas.usuarioId, usuarios.id))
    .where(eq(resenas.estado, "pendiente"))
    .orderBy(asc(resenas.creadaEn))
    .limit(LIMITE_COLA);
  return filas.map((f) => ({
    id: f.id,
    revision: revisionDe(f.estrellas, f.comentario),
    estrellas: f.estrellas,
    comentario: f.comentario,
    cliente: f.cliente,
    distrito: f.distrito,
    inicio: isoConZona(f.inicio, zona),
    creada_en: isoConZona(f.creadaEn, zona),
  }));
}

export async function contarPendientes(base: Pick<BaseDatos, "select">): Promise<number> {
  const [fila] = await base.select({ n: sql<number>`count(*)::int` }).from(resenas).where(eq(resenas.estado, "pendiente"));
  return Number(fila?.n ?? 0);
}

export type DependenciasModerar = { base: () => Pick<BaseDatos, "transaction"> };
const porDefecto: DependenciasModerar = { base: () => db() };

export type RespuestaDecision = { resena: { id: string; estado: Exclude<EstadoResena, "pendiente">; revisada_en: string } };

// Aprobar o rechazar UNA reseña pendiente. La fila se bloquea (`FOR UPDATE`): dos administradores a la vez, o un cliente que
// edita (`editar.ts`), se serializan y el segundo ve el estado nuevo y recibe 409 (con el estado actual en el mensaje). Solo
// una `pendiente` cambia; repetir la misma decisión también da 409. `revisada_en` usa el reloj de la base. Rechazar no lleva
// motivo ni borra la reseña (el cliente la edita y la reenvía). No hay vuelta atrás de una aprobada (design, decisión 5).
export async function decidirResena(
  { id, decision, adminId, revision }: { id: string; decision: "aprobada" | "rechazada"; adminId: string; revision?: string },
  dependencias: DependenciasModerar = porDefecto,
): Promise<RespuestaDecision> {
  if (!esUuid(id)) throw ErrorApi.noEncontrado(MENSAJE_RESENA_NO_ENCONTRADA);
  return transaccionDeEscritura(async (tx) => {
    const [actual] = await tx
      .select({ id: resenas.id, estado: resenas.estado, estrellas: resenas.estrellas, comentario: resenas.comentario })
      .from(resenas)
      .where(eq(resenas.id, id))
      .for("update");
    if (!actual) throw ErrorApi.noEncontrado(MENSAJE_RESENA_NO_ENCONTRADA);
    if (actual.estado !== "pendiente") {
      throw ErrorApi.conflicto(`Esa reseña ya fue revisada: está ${actual.estado === "aprobada" ? "aprobada" : "rechazada"}.`);
    }
    // Con la fila bloqueada nadie puede cambiarla ya: si la huella que vio el administrador no coincide, la editó el cliente.
    if (revision !== undefined && revision !== revisionDe(actual.estrellas, actual.comentario)) {
      throw ErrorApi.conflicto(MENSAJE_RESENA_CAMBIO);
    }
    const [decidida] = await tx
      .update(resenas)
      .set({ estado: decision, revisadaPor: adminId, revisadaEn: sql`now()`, actualizadaEn: sql`now()` })
      .where(eq(resenas.id, actual.id))
      .returning({ id: resenas.id, estado: resenas.estado, revisadaEn: resenas.revisadaEn });
    return { resena: { id: decidida.id, estado: decidida.estado as "aprobada" | "rechazada", revisada_en: new Date(decidida.revisadaEn!).toISOString() } };
  }, dependencias.base());
}
