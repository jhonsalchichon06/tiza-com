import type { Configuracion } from "../configuracion";
import { ErrorApi } from "../errores";

// Vigencia de la primera membresía (design, decisión 7): el servicio debe empezar antes de `ahora + membresia_meses`
// meses de calendario. Los 3 meses reales cuentan desde la aprobación, que es posterior a la petición.

// Suma meses de calendario; si el día no existe en el mes de destino, se recorta al último día de ese mes
// (30 de noviembre + 3 meses = 28 de febrero). Perú no tiene horario de verano.
export function sumarMeses(instante: Date, meses: number): Date {
  const resultado = new Date(instante.getTime());
  const dia = resultado.getUTCDate();
  resultado.setUTCDate(1);
  resultado.setUTCMonth(resultado.getUTCMonth() + meses);
  const ultimoDia = new Date(Date.UTC(resultado.getUTCFullYear(), resultado.getUTCMonth() + 1, 0)).getUTCDate();
  resultado.setUTCDate(Math.min(dia, ultimoDia));
  return resultado;
}

export function limitePrimeraMembresia(config: Pick<Configuracion, "membresia_meses">, ahora: Date): Date {
  return sumarMeses(ahora, config.membresia_meses);
}

// Rechaza un inicio igual o posterior al límite, diciendo hasta qué fecha puede reservar.
export function validarVigenciaPrimeraMembresia(
  config: Pick<Configuracion, "membresia_meses" | "horario_atencion">,
  ahora: Date,
  inicio: Date,
): void {
  const limite = limitePrimeraMembresia(config, ahora);
  if (inicio.getTime() < limite.getTime()) return;
  const fecha = new Intl.DateTimeFormat("es-PE", {
    timeZone: config.horario_atencion.zona,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(limite);
  throw ErrorApi.invalido(`Con tu primera membresía puedes reservar hasta el ${fecha}. Elige una fecha anterior.`);
}

// Vigencia de la membresía de un miembro (reservar-como-miembro-activo, decisión 5): el servicio debe empezar ANTES del
// `fin` de la membresía, comparando instantes (no fechas civiles). `fin` sale de la fila leída dentro de la transacción.
// Con la membresía ya vencida cualquier inicio posible (siempre posterior a hoy) queda fuera y recibe este mismo 422.
export function validarVigenciaDeMembresia(config: Pick<Configuracion, "horario_atencion">, fin: Date, inicio: Date): void {
  if (inicio.getTime() < fin.getTime()) return;
  throw ErrorApi.invalido(`Tu membresía llega hasta el ${fechaDelLimite(fin, config.horario_atencion.zona)}. ${SUFIJO_RENOVAR}`);
}

const SUFIJO_RENOVAR = "Elige una fecha anterior o renueva tu membresía para seguir reservando.";

function fechaDelLimite(limite: Date, zona: string): string {
  return new Intl.DateTimeFormat("es-PE", { timeZone: zona, day: "numeric", month: "long", year: "numeric" }).format(limite);
}
