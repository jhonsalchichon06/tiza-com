import { desc, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db/cliente";
import { reservas, resenas, usuarios } from "@/db/esquema";
import type { BaseDatos } from "../agenda/expirar";
import { errorOriginal } from "../agenda/errores-bd";
import { conReintento } from "../reintento";

export const MAXIMO_OPINIONES = 6;
// Lima no tiene horario de verano. Es la única zona que atiende el servicio (PRD: solo Lima); el mes de la limpieza se escribe
// en esta hora para que una limpieza de las 11 pm del último día no pase al mes siguiente.
const ZONA_LIMA = "America/Lima";

// Lo ÚNICO que se publica de una reseña (design de `resenas`, decisión 6; SUPUESTO sin confirmar por el negocio): nombre de
// pila, distrito, estrellas, comentario y mes de la limpieza. Esta forma NO tiene apellido, correo, celular, dirección,
// ids ni estado: no hay manera de que se escapen por la lectura pública.
export type Opinion = {
  nombrePila: string;
  distrito: string;
  estrellas: number;
  comentario: string;
  mes: string;
};

export function nombreDePila(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] || "Cliente";
}

export function mesEnEspanol(instante: Date, zona = ZONA_LIMA): string {
  return new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: zona }).format(instante);
}

// Las reseñas `aprobada` más recientes (por fecha de aprobación), máximo 6. Solo columnas permitidas: el SELECT ni siquiera
// trae el apellido completo más allá del nombre, que se recorta aquí a la primera palabra.
export async function leerOpinionesPublicas(base: Pick<BaseDatos, "select">, zona = ZONA_LIMA): Promise<Opinion[]> {
  const filas = await base
    .select({
      nombre: usuarios.name,
      distrito: reservas.distrito,
      estrellas: resenas.estrellas,
      comentario: resenas.comentario,
      inicio: reservas.inicio,
    })
    .from(resenas)
    .innerJoin(reservas, eq(resenas.reservaId, reservas.id))
    .innerJoin(usuarios, eq(reservas.usuarioId, usuarios.id))
    .where(eq(resenas.estado, "aprobada"))
    .orderBy(desc(resenas.revisadaEn))
    .limit(MAXIMO_OPINIONES);
  return filas.map((f) => ({
    nombrePila: nombreDePila(f.nombre),
    distrito: f.distrito,
    estrellas: f.estrellas,
    comentario: f.comentario,
    mes: mesEnEspanol(f.inicio, zona),
  }));
}

// La landing NUNCA falla por las opiniones (design, decisión 7): es contenido accesorio. Un reintento (ADR 0006) y, si aun así
// falla, el error se registra y se devuelve [] (la página se publica sin la sección). Si el error ocurre durante una
// regeneración o el `next build`, esa versión queda sin la sección hasta la siguiente regeneración.
export async function leerOpinionesSinFallar(
  leer: () => Promise<Opinion[]> = () => leerOpinionesPublicas(db()),
  esperaReintentoMs?: number,
): Promise<Opinion[]> {
  try {
    return await conReintento(async () => {
      try {
        return await leer();
      } catch (error) {
        throw errorOriginal(error);
      }
    }, esperaReintentoMs);
  } catch (error) {
    console.error("No se pudieron leer las opiniones de clientes; la landing se publica sin la sección:", error);
    return [];
  }
}

// El layout (menú) y la página llaman a esta misma función: `cache` de React la ejecuta una sola vez por generación.
export const leerOpiniones = cache(() => leerOpinionesSinFallar());
