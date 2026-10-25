import { and, desc, eq, ne, or } from "drizzle-orm";
import { reservas, usuarios } from "@/db/esquema";
import { reservaActiva } from "@/db/reservas-activas";
import type { BaseDatos } from "../agenda/expirar";

// Direcciones parecidas para el administrador (PRD, caso borde 10; ADR 0013). Es una ayuda, no una garantía: mostrar de
// más es aceptable porque decide el administrador. Las funciones puras trabajan sobre `direccion_normalizada`
// ("<calle normalizada> <número normalizado>", ya sin tildes ni mayúsculas y con "av" → "avenida", "jr" → "jiron").

// Heurísticas iniciales (design, Open Questions 2): se ajustan con direcciones reales. No son datos de negocio.
export const TIPOS_DE_VIA = ["avenida", "jiron", "calle", "pasaje", "alameda"] as const;
export const ARTICULOS = ["de", "del", "la", "las", "los", "el"] as const;
export const LETRAS_CORTA = 8; // hasta aquí se tolera 1 letra de diferencia
export const DIFERENCIA_CORTA = 1;
export const DIFERENCIA_LARGA = 2; // con más de LETRAS_CORTA letras

export type Nivel = "misma_direccion" | "otro_departamento" | "calle_parecida";
const ORDEN_DE_NIVEL: Record<Nivel, number> = { misma_direccion: 0, otro_departamento: 1, calle_parecida: 2 };

export type DireccionComparable = {
  distrito: string;
  direccionNormalizada: string;
  departamentoNormalizado: string;
};

const tokens = (texto: string) => texto.split(" ").filter(Boolean);

// Primera secuencia de dígitos del último token ("123a" → "123"); null si no hay.
export function numeroDe(direccionNormalizada: string): string | null {
  const ultimo = tokens(direccionNormalizada).at(-1) ?? "";
  return ultimo.match(/\d+/)?.[0] ?? null;
}

// La calle de la dirección normalizada: todo menos el número (el último token).
export function callePorNumero(direccionNormalizada: string): string {
  return tokens(direccionNormalizada).slice(0, -1).join(" ");
}

function palabrasDeCalle(calle: string): string[] {
  const todas = tokens(calle);
  const utiles = todas.filter((p) => !(TIPOS_DE_VIA as readonly string[]).includes(p) && !(ARTICULOS as readonly string[]).includes(p));
  return utiles.length > 0 ? utiles : todas;
}

function distanciaDeEdicion(a: string, b: string): number {
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    for (let j = 1; j <= b.length; j++) {
      actual[j] = Math.min(anterior[j] + 1, actual[j - 1] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    anterior = actual;
  }
  return anterior[b.length];
}

// Parecidas: mismas palabras, una contenida en la otra, o a lo sumo 1 letra de diferencia (hasta 8 letras) o 2 (más).
export function callesParecidas(a: string, b: string): boolean {
  const pa = palabrasDeCalle(a);
  const pb = palabrasDeCalle(b);
  if (pa.length === 0 || pb.length === 0) return false;
  const conjuntoA = new Set(pa);
  const conjuntoB = new Set(pb);
  const contiene = (mayor: Set<string>, menor: Set<string>) => [...menor].every((p) => mayor.has(p));
  if (contiene(conjuntoA, conjuntoB) || contiene(conjuntoB, conjuntoA)) return true;
  const ua = pa.join("");
  const ub = pb.join("");
  const tolerancia = Math.max(ua.length, ub.length) <= LETRAS_CORTA ? DIFERENCIA_CORTA : DIFERENCIA_LARGA;
  return distanciaDeEdicion(ua, ub) <= tolerancia;
}

// Nivel de la coincidencia de `otra` con la `revisada`, o null si no se parecen. Solo compara dentro del mismo distrito.
export function clasificarCoincidencia(revisada: DireccionComparable, otra: DireccionComparable): Nivel | null {
  if (revisada.distrito !== otra.distrito) return null;
  if (revisada.direccionNormalizada === otra.direccionNormalizada) {
    return revisada.departamentoNormalizado === otra.departamentoNormalizado ? "misma_direccion" : "otro_departamento";
  }
  const numero = numeroDe(revisada.direccionNormalizada);
  if (numero === null || numero !== numeroDe(otra.direccionNormalizada)) return null;
  return callesParecidas(callePorNumero(revisada.direccionNormalizada), callePorNumero(otra.direccionNormalizada)) ? "calle_parecida" : null;
}

export type Coincidencia = {
  nivel: Nivel;
  cliente: string;
  distrito: string;
  calle: string;
  numero: string;
  departamento: string | null;
  estado: string;
  inicio: Date;
};

export type ResultadoCoincidencias = { aplica: boolean; coincidencias: Coincidencia[] };

// Coincidencias de la limpieza gratis de una membresía. La reserva que se revisa es la `primera_gratis` más reciente de la
// membresía, sin importar su estado ni su `pago_id`: un pago de reenvío (que ya no tiene reserva) conserva su contexto.
// Es solo lectura y no usa `decidirLimpiezaGratis` ni nada de la regla de la limpieza gratis (ítem 10).
export async function buscarCoincidencias(base: Pick<BaseDatos, "select">, membresiaId: string | null): Promise<ResultadoCoincidencias> {
  if (membresiaId === null) return { aplica: false, coincidencias: [] };
  const [revisada] = await base
    .select({
      usuarioId: reservas.usuarioId,
      distrito: reservas.distrito,
      direccionNormalizada: reservas.direccionNormalizada,
      departamentoNormalizado: reservas.departamentoNormalizado,
    })
    .from(reservas)
    .where(and(eq(reservas.membresiaId, membresiaId), eq(reservas.primeraGratis, true)))
    .orderBy(desc(reservas.creadaEn))
    .limit(1);
  if (!revisada) return { aplica: false, coincidencias: [] };

  const candidatas = await base
    .select({
      cliente: usuarios.name,
      distrito: reservas.distrito,
      calle: reservas.calle,
      numero: reservas.numero,
      departamento: reservas.departamento,
      direccionNormalizada: reservas.direccionNormalizada,
      departamentoNormalizado: reservas.departamentoNormalizado,
      estado: reservas.estado,
      inicio: reservas.inicio,
    })
    .from(reservas)
    .innerJoin(usuarios, eq(usuarios.id, reservas.usuarioId))
    .where(
      and(
        eq(reservas.primeraGratis, true),
        eq(reservas.distrito, revisada.distrito),
        ne(reservas.usuarioId, revisada.usuarioId),
        // Confirmada, pendiente vigente (reservaActiva) o completada; no las canceladas, expiradas ni pendientes vencidas.
        or(reservaActiva, eq(reservas.estado, "completada")),
      ),
    );

  const coincidencias: Coincidencia[] = [];
  for (const c of candidatas) {
    const nivel = clasificarCoincidencia(revisada, c);
    if (nivel) {
      coincidencias.push({
        nivel,
        cliente: c.cliente,
        distrito: c.distrito,
        calle: c.calle,
        numero: c.numero,
        departamento: c.departamento,
        estado: c.estado,
        inicio: c.inicio,
      });
    }
  }
  coincidencias.sort((x, y) => ORDEN_DE_NIVEL[x.nivel] - ORDEN_DE_NIVEL[y.nivel]);
  return { aplica: true, coincidencias };
}
