import { isoConZona } from "../agenda/horario";
import type { FilaMembresia, MembresiaDelPerfil, PagoReenviable } from "../perfil/membresia";
import { formatearFecha } from "../perfil/textos";
import { formatearSoles } from "../soles";
import type { PlanDeRenovacion } from "./plan";

// Estado de renovación del cliente (renovacion-del-mes-4, decisión 2). Se DERIVA al leer con el reloj de la base (cada
// fila trae `vigente` y `segundosRestantes` calculados en SQL con `now()`): "vencida" no se guarda (ADR 0008). Una membresía
// `caducada` no cuenta. Pura: no lee la base ni el reloj del servidor.

export type Renovacion =
  | { estado: "no_aplica" }
  | { estado: "por_vencer"; fin: string; dias_restantes: number; texto: string }
  | { estado: "vencida"; fin: string; plan: PlanDeRenovacion; texto: string }
  | { estado: "renovacion_en_revision"; pago_id: string | null; texto: string }
  // El formulario de reenvío y el motivo los muestra el aviso `pago_rechazado` del perfil (definición única del ítem 11).
  | { estado: "renovacion_rechazada"; pago_id: string; motivo_rechazo: string | null; reenvio_hasta: string; dias_restantes: number; texto: string };

export type EstadoDeRenovacion = Renovacion["estado"];

const DIA_S = 86_400;
const DIA_MS = 86_400_000;

export const TEXTO_RENOVACION_EN_REVISION = "Tu pago de renovación está en revisión. Cuando se apruebe, podrás elegir día y hora desde tu perfil.";

export function textoPorVencer(fin: Date, zona: string): string {
  return `Tu membresía vence el ${formatearFecha(fin, zona)}. No podrás agendar limpiezas para después de esa fecha. Cuando venza, deberás realizar un nuevo pago para seguir reservando.`;
}

export function textoVencida(fin: Date, zona: string, plan: PlanDeRenovacion): string {
  return `Tu membresía venció el ${formatearFecha(fin, zona)}. Realiza un nuevo pago para que tu servicio del mes 4 sea válido. Renovar por ${textoMeses(plan.meses)}: ${formatearSoles(plan.monto)}.`;
}

export function textoMeses(meses: number): string {
  return meses === 1 ? "1 mes" : `${meses} meses`;
}

export function textoRechazada(limite: Date, zona: string): string {
  return `Tu pago de renovación fue rechazado. Sube otro comprobante antes del ${formatearFecha(limite, zona)}.`;
}

export function estadoDeRenovacion({
  membresias,
  pagosReenviables,
  avisoDias,
  zona,
  plan,
  ahora,
}: {
  membresias: FilaMembresia[];
  pagosReenviables: PagoReenviable[];
  avisoDias: number;
  zona: string;
  plan: PlanDeRenovacion;
  ahora: Date;
}): Renovacion {
  const activas = membresias.filter((m) => m.estado === "activa" && m.fin);
  if (activas.length === 0) return { estado: "no_aplica" };

  const porFin = (a: FilaMembresia, b: FilaMembresia) => (b.fin?.getTime() ?? 0) - (a.fin?.getTime() ?? 0);
  const vigente = activas.filter((m) => m.vigente).sort(porFin)[0];
  if (vigente?.fin) {
    const segundos = vigente.segundosRestantes ?? 0;
    if (segundos > avisoDias * DIA_S) return { estado: "no_aplica" };
    return {
      estado: "por_vencer",
      fin: isoConZona(vigente.fin, zona),
      dias_restantes: Math.max(1, Math.ceil(segundos / DIA_S)),
      texto: textoPorVencer(vigente.fin, zona),
    };
  }

  // Todas las activas están vencidas: se mira la renovación pendiente, si hay.
  const ultima = activas.sort(porFin)[0];
  const fin = ultima.fin as Date;
  const vencida: Renovacion = { estado: "vencida", fin: isoConZona(fin, zona), plan, texto: textoVencida(fin, zona, plan) };

  const pendiente = renovacionPendiente(membresias, pagosReenviables);
  if (pendiente.tipo === "ninguna") return vencida;
  if (pendiente.tipo === "rechazada") {
    const { pagoId, reenviable } = pendiente;
    const restante = reenviable.reenvioHasta.getTime() - ahora.getTime();
    return {
      estado: "renovacion_rechazada",
      pago_id: pagoId,
      motivo_rechazo: reenviable.motivoRechazo,
      reenvio_hasta: isoConZona(reenviable.reenvioHasta, zona),
      dias_restantes: Math.max(1, Math.ceil(restante / DIA_MS)),
      texto: textoRechazada(reenviable.reenvioHasta, zona),
    };
  }
  return { estado: "renovacion_en_revision", pago_id: pendiente.pagoId, texto: TEXTO_RENOVACION_EN_REVISION };
}

export type RenovacionPendiente =
  | { tipo: "ninguna" }
  | { tipo: "en_revision"; pagoId: string | null }
  | { tipo: "rechazada"; pagoId: string; reenviable: PagoReenviable };

// Definición única de «el cliente vencido ya envió su renovación»: la membresía `pendiente` con su último pago. Un pago
// rechazado cuenta solo dentro del plazo de reenvío (`pagosRechazadosReenviables`, ítem 11), aunque el cierre perezoso no
// haya corrido; fuera del plazo es como si no hubiera renovación (se puede pagar de nuevo). La usan el estado de renovación
// y el guard de vigencia.
export function renovacionPendiente(membresias: FilaMembresia[], pagosReenviables: PagoReenviable[]): RenovacionPendiente {
  const pendiente = membresias.find((m) => m.estado === "pendiente");
  if (!pendiente) return { tipo: "ninguna" };
  const pago = pendiente.ultimoPago;
  if (pago?.estado === "rechazado") {
    const reenviable = pagosReenviables.find((p) => p.pagoId === pago.id);
    return reenviable ? { tipo: "rechazada", pagoId: pago.id, reenviable } : { tipo: "ninguna" };
  }
  return { tipo: "en_revision", pagoId: pago?.id ?? null };
}

// Una membresía `pendiente` junto a una `activa` es una renovación, no la primera membresía. El estado de membresía del
// ítem 12 (`estadoDeMembresia`) elige la `pendiente` antes que la `activa` vencida y mostraría el texto de la primera
// membresía; para que no la confunda se le entregan solo las membresías que no son renovaciones. Sus valores no cambian.
export function sinRenovacionesPendientes(membresias: FilaMembresia[]): FilaMembresia[] {
  if (!membresias.some((m) => m.estado === "activa")) return membresias;
  return membresias.filter((m) => m.estado !== "pendiente");
}

// El perfil ofrece elegir día y hora solo con la membresía vigente y sin una renovación en curso.
export function puedeElegirDiaYHora(membresia: MembresiaDelPerfil, renovacion: Renovacion): boolean {
  return membresia.estado === "activa" && (renovacion.estado === "no_aplica" || renovacion.estado === "por_vencer");
}
