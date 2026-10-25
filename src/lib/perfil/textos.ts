import { horaLocal } from "../agenda/horario";

// Textos del perfil en español de Perú. Las fechas van en la zona de `horario_atencion`; los montos con `formatearSoles`.

const aDate = (valor: Date | string) => (valor instanceof Date ? valor : new Date(valor));

function partesDeFecha(instante: Date, zona: string) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("es-PE", { timeZone: zona, weekday: "long", day: "numeric", month: "long", year: "numeric" })
      .formatToParts(instante)
      .map((p) => [p.type, p.value]),
  );
  return { diaSemana: partes.weekday, dia: partes.day, mes: partes.month, anio: partes.year };
}

// "10:00" → "10:00 am"; "15:30" → "3:30 pm". Se escribe a mano para no depender del ICU del servidor.
export function hora12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

// "martes 15 de diciembre, 10:00 am"
export function formatearFechaHora(valor: Date | string, zona: string): string {
  const instante = aDate(valor);
  const p = partesDeFecha(instante, zona);
  return `${p.diaSemana} ${p.dia} de ${p.mes}, ${hora12(horaLocal(instante, zona))}`;
}

// "15 de diciembre de 2026"
export function formatearFecha(valor: Date | string, zona: string): string {
  const p = partesDeFecha(aDate(valor), zona);
  return `${p.dia} de ${p.mes} de ${p.anio}`;
}

// "10:00 am"
export function formatearHora(valor: Date | string, zona: string): string {
  return hora12(horaLocal(aDate(valor), zona));
}
