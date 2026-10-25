import type { Configuracion } from "../configuracion";
import { ErrorApi } from "../errores";

// Reglas del horario de la agenda (PRD, ADR 0007 y 0009). Funciones puras sobre `configuracion`:
// no leen la base ni el reloj. Las horas locales usan la zona de `horario_atencion.zona` con Intl.

const HORA = 3_600_000;
const MINUTO = 60_000;
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export type RangoBloqueado = { inicio: Date; fin: Date; finBloqueo: Date };

function partesEnZona(instante: Date, zona: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(instante).map((x) => [x.type, x.value]));
  return { anio: +p.year, mes: +p.month, dia: +p.day, hora: +p.hour, minuto: +p.minute, segundo: +p.second };
}

// Cuánto se adelanta la hora de la zona respecto de UTC en ese instante (negativo al oeste, como Lima).
function desfaseDeZona(instante: Date, zona: string): number {
  const p = partesEnZona(instante, zona);
  const comoUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

const FORMATO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

// Rechaza fechas que no existen (2026-02-30) y las que no tienen el formato AAAA-MM-DD.
export function validarFecha(fecha: unknown): string {
  const mensaje = "Escribe una fecha válida con el formato AAAA-MM-DD.";
  if (typeof fecha !== "string") throw ErrorApi.invalido(mensaje);
  const m = FORMATO_FECHA.exec(fecha);
  if (!m) throw ErrorApi.invalido(mensaje);
  const [anio, mes, dia] = [+m[1], +m[2], +m[3]];
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    throw ErrorApi.invalido(mensaje);
  }
  return fecha;
}

// Día de la semana de una fecha civil (0 = domingo); no depende de la zona.
export function diaDeLaSemana(fecha: string): number {
  const [anio, mes, dia] = validarFecha(fecha).split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
}

// "AAAA-MM-DD" + "HH:mm" en la zona dada → instante. Dos pasadas por si el desfase cambia ese día.
export function instanteLocal(fecha: string, hora: string, zona: string): Date {
  const [anio, mes, dia] = validarFecha(fecha).split("-").map(Number);
  const [h, min] = hora.split(":").map(Number);
  const comoUtc = Date.UTC(anio, mes - 1, dia, h, min);
  let instante = new Date(comoUtc - desfaseDeZona(new Date(comoUtc), zona));
  instante = new Date(comoUtc - desfaseDeZona(instante, zona));
  return instante;
}

export function horaLocal(instante: Date, zona: string): string {
  const p = partesEnZona(instante, zona);
  return `${String(p.hora).padStart(2, "0")}:${String(p.minuto).padStart(2, "0")}`;
}

export function fechaLocal(instante: Date, zona: string): string {
  const p = partesEnZona(instante, zona);
  return `${p.anio}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

const aMinutos = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// 08:00 → "8 am", 18:30 → "6:30 pm".
function hora12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const sufijo = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${sufijo}` : `${h12}:${String(m).padStart(2, "0")} ${sufijo}`;
}

function describirDias(dias: number[]): string {
  const orden = [...dias].sort((a, b) => a - b);
  const consecutivos = orden.every((d, i) => i === 0 || d === orden[i - 1] + 1);
  const nombres = orden.map((d) => DIAS[d]);
  if (consecutivos && nombres.length >= 3) return `${nombres[0]} a ${nombres[nombres.length - 1]}`;
  if (nombres.length === 1) return nombres[0];
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

// El rango bloqueado es el servicio más el traslado. `horasAgenda` viene de calcularServicio: no se recalcula.
export function rangoBloqueado(config: Configuracion, inicio: Date, horasAgenda: number): RangoBloqueado {
  const fin = new Date(inicio.getTime() + horasAgenda * HORA);
  return { inicio, fin, finBloqueo: new Date(fin.getTime() + config.traslado_horas * HORA) };
}

// Inicios posibles de un día: cada `intervalo` desde la apertura mientras el servicio termine antes del cierre.
export function iniciosDelDia(config: Configuracion, fecha: string, horasAgenda: number): Date[] {
  const { dias, apertura, cierre, zona } = config.horario_atencion;
  if (!dias.includes(diaDeLaSemana(fecha))) return [];
  const finDelDia = instanteLocal(fecha, cierre, zona).getTime();
  const paso = config.intervalo_horarios_minutos * MINUTO;
  const inicios: Date[] = [];
  for (let t = instanteLocal(fecha, apertura, zona).getTime(); t + horasAgenda * HORA <= finDelDia; t += paso) {
    inicios.push(new Date(t));
  }
  return inicios;
}

// El servidor es quien decide: el navegador no es la única defensa. Cada incumplimiento tiene su mensaje.
export function validarInicioServicio(config: Configuracion, ahora: Date, inicio: Date, horasAgenda: number): void {
  const { dias, apertura, cierre, zona } = config.horario_atencion;
  const fecha = fechaLocal(inicio, zona);
  if (!dias.includes(diaDeLaSemana(fecha))) {
    throw ErrorApi.invalido(`Atendemos de ${describirDias(dias)}. Elige otro día.`);
  }
  const horario = `${hora12(apertura)} a ${hora12(cierre)}`;
  const inicioMin = aMinutos(horaLocal(inicio, zona));
  const finMs = inicio.getTime() + horasAgenda * HORA;
  if (inicioMin < aMinutos(apertura)) {
    throw ErrorApi.invalido(`El horario de atención es de ${horario}. Elige una hora de inicio dentro de ese horario.`);
  }
  if (finMs > instanteLocal(fecha, cierre, zona).getTime()) {
    throw ErrorApi.invalido(`El horario de atención es de ${horario}. El servicio debe terminar antes de las ${hora12(cierre)}.`);
  }
  if ((inicioMin - aMinutos(apertura)) % config.intervalo_horarios_minutos !== 0) {
    throw ErrorApi.invalido(`Los horarios son cada ${config.intervalo_horarios_minutos} minutos desde las ${hora12(apertura)}.`);
  }
  if (inicio.getTime() - ahora.getTime() < config.anticipacion_minima_horas * HORA) {
    throw ErrorApi.invalido(`Reserva con al menos ${config.anticipacion_minima_horas} horas de anticipación.`);
  }
}

// "2026-12-01T10:00:00-05:00": el instante con el desfase de la zona, para que la interfaz no adivine.
export function isoConZona(instante: Date, zona: string): string {
  const desfaseMin = Math.round(desfaseDeZona(instante, zona) / MINUTO);
  const signo = desfaseMin < 0 ? "-" : "+";
  const abs = Math.abs(desfaseMin);
  const sufijo = `${signo}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return `${fechaLocal(instante, zona)}T${horaLocal(instante, zona)}:00${sufijo}`;
}
