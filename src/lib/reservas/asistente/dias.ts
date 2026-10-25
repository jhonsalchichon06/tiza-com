// Días reservables y horarios permitidos. El navegador no calcula las 48 horas ni los 3 meses (ADR 0008):
// recorre fechas civiles AAAA-MM-DD que da la cotización y compara instantes ISO con el límite del servidor.
// No usa `Date` local: la zona del dispositivo no debe cambiar qué día es.

const FORMATO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DIA_MS = 86_400_000;

function aUtc(fecha: string): number | null {
  const m = FORMATO.exec(fecha);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

function aFecha(utc: number): string {
  const d = new Date(utc);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
}

// Todos los días entre `desde` y `hasta` (ambos incluidos), sin domingos.
export function diasReservables(desde: string, hasta: string): string[] {
  const inicio = aUtc(desde);
  const fin = aUtc(hasta);
  if (inicio === null || fin === null) return [];
  const dias: string[] = [];
  for (let t = inicio; t <= fin; t += DIA_MS) {
    if (new Date(t).getUTCDay() !== 0) dias.push(aFecha(t));
  }
  return dias;
}

// Un horario es permitido solo si empieza antes del instante límite de la cotización.
export function horarioPermitido(horario: string, limite: string): boolean {
  const h = Date.parse(horario);
  const l = Date.parse(limite);
  if (Number.isNaN(h) || Number.isNaN(l)) return false;
  return h < l;
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function nombreDelDia(fecha: string): string {
  const t = aUtc(fecha);
  return t === null ? fecha : DIAS[new Date(t).getUTCDay()];
}

export function numeroDelDia(fecha: string): number {
  const t = aUtc(fecha);
  return t === null ? 0 : new Date(t).getUTCDate();
}

// "2026-11-04" → "noviembre de 2026" (título de cada mes del calendario).
export function nombreDelMes(fecha: string): string {
  const t = aUtc(fecha);
  if (t === null) return fecha;
  const d = new Date(t);
  return `${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

// "2026-11-04" → "miércoles 4 de noviembre".
export function describirDia(fecha: string): string {
  const t = aUtc(fecha);
  if (t === null) return fecha;
  const d = new Date(t);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}
