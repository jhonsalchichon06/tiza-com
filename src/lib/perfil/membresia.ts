import { desc, eq, isNotNull, and, sql } from "drizzle-orm";
import { membresias, pagos } from "@/db/esquema";
import type { BaseDatos } from "../agenda/expirar";
import { isoConZona } from "../agenda/horario";

// Estado de la membresía del cliente derivado de lo guardado (ADR 0008): "vencida" no se guarda y la vigencia se mide
// con el reloj de la base (`fin > now()` en SQL), nunca con el del servidor.

export type EstadoPagoMembresia = "pendiente" | "aprobado" | "rechazado";

export type FilaMembresia = {
  id: string;
  estado: "pendiente" | "activa" | "caducada";
  inicio: Date | null;
  fin: Date | null;
  // Calculados en SQL con el `now()` de la base.
  vigente: boolean;
  segundosRestantes: number | null;
  ultimoPago: { id: string; estado: EstadoPagoMembresia } | null;
};

// Un pago rechazado que todavía puede reemplazarse (definición única: `pagosRechazadosReenviables` del ítem 11).
export type PagoReenviable = { pagoId: string; reenvioHasta: Date; motivoRechazo: string | null };

export type MembresiaDelPerfil =
  | { estado: "sin_membresia"; plazo_vencido: boolean }
  | { estado: "en_revision"; pago_id: string | null }
  | { estado: "pago_rechazado"; pago_id: string; motivo_rechazo: string | null; reenvio_hasta: string }
  | { estado: "activa"; inicio: string; fin: string; dias_restantes: number }
  | { estado: "vencida"; fin: string };

const DIA_S = 86_400;

// Elige la membresía que cuenta: la `activa` vigente; si no, la `pendiente`; si no, la `activa` vencida más reciente.
// Las `caducada` no cuentan. Pura: el reloj ya viene calculado en cada fila.
export function estadoDeMembresia({
  membresias: filas,
  pagosReenviables,
  zona,
}: {
  membresias: FilaMembresia[];
  pagosReenviables: PagoReenviable[];
  zona: string;
}): MembresiaDelPerfil {
  const porFin = (a: FilaMembresia, b: FilaMembresia) => (b.fin?.getTime() ?? 0) - (a.fin?.getTime() ?? 0);
  const activaVigente = filas.filter((m) => m.estado === "activa" && m.vigente).sort(porFin)[0];
  if (activaVigente?.inicio && activaVigente.fin) {
    return {
      estado: "activa",
      inicio: isoConZona(activaVigente.inicio, zona),
      fin: isoConZona(activaVigente.fin, zona),
      dias_restantes: Math.max(1, Math.ceil((activaVigente.segundosRestantes ?? 0) / DIA_S)),
    };
  }

  const pendiente = filas.find((m) => m.estado === "pendiente");
  if (pendiente) {
    const pago = pendiente.ultimoPago;
    if (pago?.estado === "rechazado") {
      const reenviable = pagosReenviables.find((p) => p.pagoId === pago.id);
      // Fuera del plazo aunque el cierre perezoso no haya corrido: el perfil nunca depende de que alguien lo dispare.
      if (!reenviable) return { estado: "sin_membresia", plazo_vencido: true };
      return {
        estado: "pago_rechazado",
        pago_id: pago.id,
        motivo_rechazo: reenviable.motivoRechazo,
        reenvio_hasta: isoConZona(reenviable.reenvioHasta, zona),
      };
    }
    return { estado: "en_revision", pago_id: pago?.id ?? null };
  }

  const vencida = filas.filter((m) => m.estado === "activa").sort(porFin)[0];
  if (vencida?.fin) return { estado: "vencida", fin: isoConZona(vencida.fin, zona) };

  return { estado: "sin_membresia", plazo_vencido: filas.some((m) => m.estado === "caducada") };
}

// Trae SOLO las membresías del cliente (filtro por `usuario_id` en SQL) con el estado de su último pago.
export async function leerMembresiaDelCliente(base: Pick<BaseDatos, "select">, usuarioId: string): Promise<FilaMembresia[]> {
  const filas = await base
    .select({
      id: membresias.id,
      estado: membresias.estado,
      inicio: membresias.inicio,
      fin: membresias.fin,
      vigente: sql<boolean>`coalesce(${membresias.fin} > now(), false)`,
      segundosRestantes: sql<string | number | null>`extract(epoch from (${membresias.fin} - now()))`,
    })
    .from(membresias)
    .where(eq(membresias.usuarioId, usuarioId));
  if (filas.length === 0) return [];

  const delPago = await base
    .select({ id: pagos.id, membresiaId: pagos.membresiaId, estado: pagos.estado })
    .from(pagos)
    .where(and(eq(pagos.usuarioId, usuarioId), isNotNull(pagos.membresiaId)))
    .orderBy(desc(pagos.creadoEn));

  return filas.map((m) => {
    const ultimo = delPago.find((p) => p.membresiaId === m.id);
    return {
      id: m.id,
      estado: m.estado,
      inicio: m.inicio,
      fin: m.fin,
      vigente: Boolean(m.vigente),
      segundosRestantes: m.segundosRestantes === null || m.segundosRestantes === undefined ? null : Number(m.segundosRestantes),
      ultimoPago: ultimo ? { id: ultimo.id, estado: ultimo.estado } : null,
    };
  });
}
