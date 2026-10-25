import { formatearHoras } from "@/lib/soles";
import { TIPOS_DE_SERVICIO } from "../pagos/formato";

// Textos compartidos por /admin/reservas y /admin/apoyo. Las fechas llegan del servidor con la hora de Lima escrita en el
// texto: se leen tal cual (`fechaYHora` de ../pagos/formato), sin pasar por el reloj del dispositivo.

export function servicioEnTexto(s: { tipo: string; dormitorios: number | null; banos: number | null; horas_trabajo: number }): string {
  if (s.tipo === "paquete") return `Paquete de ${formatearHoras(s.horas_trabajo)}`;
  const tipo = TIPOS_DE_SERVICIO[s.tipo] ?? s.tipo;
  return `${tipo} · ${s.dormitorios ?? 0} dorm. y ${s.banos ?? 0} baños · ${formatearHoras(s.horas_trabajo)}`;
}

export function direccionEnTexto(d: { distrito: string; calle: string; numero: string; departamento: string | null }): string {
  return `${d.calle} ${d.numero}${d.departamento ? `, ${d.departamento}` : ""}, ${d.distrito}`;
}

// "2026-11-06T10:00:00-05:00" → "10:00"
export const horaDe = (iso: string): string => iso.slice(11, 16);

export function diasRestantesEnTexto(dias: number): string {
  if (dias < 0) return `pasó hace ${-dias} ${dias === -1 ? "día" : "días"}`;
  if (dias === 0) return "es hoy";
  return `faltan ${dias} ${dias === 1 ? "día" : "días"}`;
}
