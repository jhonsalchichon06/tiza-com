// Formato de las páginas públicas. Los montos y las horas reutilizan `soles.ts` (una sola lógica de céntimos);
// aquí solo se agrega la descripción del horario de atención.
export { formatearHoras, formatearSoles } from "./soles";

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// "08:00" → "8 am", "18:00" → "6 pm", "12:30" → "12:30 pm".
function describirHora(hora: string): string {
  const [h, m] = hora.split(":").map(Number);
  const sufijo = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${sufijo}` : `${h12}:${String(m).padStart(2, "0")} ${sufijo}`;
}

function unir(nombres: string[]): string {
  if (nombres.length === 1) return nombres[0];
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

// { dias: [1..6], apertura: "08:00", cierre: "18:00" } → "lunes a sábado, de 8 am a 6 pm".
export function describirHorario(horario: { dias: number[]; apertura: string; cierre: string }): string {
  // La semana empieza en lunes: el domingo (0) va al final.
  const dias = [...new Set(horario.dias)].map((d) => (d === 0 ? 7 : d)).sort((a, b) => a - b);
  const consecutivos = dias.length >= 3 && dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
  const nombre = (d: number) => DIAS[d % 7];
  const textoDias = consecutivos
    ? `${nombre(dias[0])} a ${nombre(dias[dias.length - 1])}`
    : unir(dias.map(nombre));
  return `${textoDias}, de ${describirHora(horario.apertura)} a ${describirHora(horario.cierre)}`;
}
