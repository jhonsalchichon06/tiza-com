import { isoConZona } from "../agenda/horario";
import type { Configuracion } from "../configuracion";
import { formatearHoras } from "../soles";
import type { MembresiaDelPerfil, PagoReenviable } from "./membresia";
import { formatearFecha, formatearHora } from "./textos";

// Avisos del perfil con códigos estables (la interfaz y las pruebas se apoyan en el código, no en el texto).
// Las decisiones (si se ofrece subir otro comprobante, si hay horario pendiente) vienen de las consultas del servidor;
// aquí solo se escriben. El plazo en días se calcula desde `reenvio_hasta` solo para mostrarlo.

export type CodigoAviso =
  | "en_revision"
  | "pago_rechazado"
  | "plazo_vencido"
  | "nuevo_horario"
  | "limpieza_gratis_conservada"
  | "vencida";

export type Aviso = {
  codigo: CodigoAviso;
  texto: string;
  pago_id?: string;
  motivo?: string;
  dias_restantes?: number;
  reenvio_hasta?: string;
  // Hora límite de la espera de la reserva que acompaña a este pago, si está viva (ISO con desfase de Lima).
  reserva_expira_en?: string;
  enlace?: { texto: string; href: string };
};

export const TEXTO_EN_REVISION = "Tu pago está en revisión. Te avisaremos aquí cuando se apruebe.";
export const TEXTO_PLAZO_VENCIDO = "Pasó el plazo para subir otro comprobante. Puedes empezar de nuevo con una reserva y un pago nuevos.";
export const TEXTO_NUEVO_HORARIO = "Tu pago fue aprobado. Elige un nuevo día y hora para tu limpieza, no tienes que pagar otra vez.";

const DIA_MS = 86_400_000;

export function construirAvisos({
  membresia,
  rechazados,
  pagosNuevoHorario,
  gratisConservada,
  config,
  zona,
  ahora,
  reservaEnEsperaHasta = null,
}: {
  membresia: MembresiaDelPerfil;
  rechazados: PagoReenviable[];
  pagosNuevoHorario: { id: string }[];
  gratisConservada: boolean;
  config: Pick<Configuracion, "horas_gratis">;
  zona: string;
  ahora: Date;
  reservaEnEsperaHasta?: string | null;
}): Aviso[] {
  const avisos: Aviso[] = [];

  if (membresia.estado === "en_revision") avisos.push({ codigo: "en_revision", texto: TEXTO_EN_REVISION });

  for (const r of rechazados) {
    const restante = r.reenvioHasta.getTime() - ahora.getTime();
    const diasRestantes = Math.max(1, Math.ceil(restante / DIA_MS));
    const texto =
      restante < DIA_MS
        ? `Tu comprobante fue rechazado. Hoy es tu último día para subir otro comprobante, hasta las ${formatearHora(r.reenvioHasta, zona)}.`
        : `Tu comprobante fue rechazado. Te quedan ${diasRestantes} días para subir otro, hasta el ${formatearFecha(r.reenvioHasta, zona)}.`;
    avisos.push({
      codigo: "pago_rechazado",
      texto,
      pago_id: r.pagoId,
      ...(r.motivoRechazo ? { motivo: r.motivoRechazo } : {}),
      dias_restantes: diasRestantes,
      reenvio_hasta: isoConZona(r.reenvioHasta, zona),
      ...(reservaEnEsperaHasta ? { reserva_expira_en: reservaEnEsperaHasta } : {}),
    });
  }

  if (membresia.estado === "sin_membresia" && membresia.plazo_vencido) {
    avisos.push({ codigo: "plazo_vencido", texto: TEXTO_PLAZO_VENCIDO, enlace: { texto: "Empezar de nuevo", href: "/reservar" } });
  }

  for (const p of pagosNuevoHorario) avisos.push({ codigo: "nuevo_horario", texto: TEXTO_NUEVO_HORARIO, pago_id: p.id });

  if (gratisConservada) {
    avisos.push({
      codigo: "limpieza_gratis_conservada",
      texto: `Tu limpieza gratis sigue disponible: tu próxima reserva llevará ${textoHorasGratis(config.horas_gratis)} sin costo.`,
    });
  }

  if (membresia.estado === "vencida") {
    avisos.push({ codigo: "vencida", texto: `Tu membresía venció el ${formatearFecha(membresia.fin, zona)}.` });
  }

  return avisos;
}

// 3 → "las 3 primeras horas"; 1 → "la primera hora"; 2,5 → "las 2,5 primeras horas".
function textoHorasGratis(horas: number): string {
  if (horas === 1) return "la primera hora";
  return `las ${formatearHoras(horas).replace(/ horas$/, "")} primeras horas`;
}
