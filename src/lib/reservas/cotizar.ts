import type { Configuracion } from "../configuracion";
import { fechaLocal, isoConZona } from "../agenda/horario";
import { calcularServicio, type EntradaServicio, type ResultadoServicio } from "../precios";
import type { MotivoSinGratis } from "./gratis";
import { limitePrimeraMembresia } from "./vigencia";

type CotizacionComun = ResultadoServicio & {
  aplica_gratis: boolean;
  // Por qué no aplican las 3 horas gratis: el cliente ya tuvo su limpieza gratis o la dirección ya recibió la suya.
  motivo_sin_gratis: MotivoSinGratis | null;
  total_a_pagar: number;
  espera_pago_horas: number;
  // Fechas civiles AAAA-MM-DD de la zona de atención: la primera en que se cumple la anticipación y la del límite.
  fechas: { desde: string; hasta: string };
  // Instante exacto (ISO con zona) desde el cual ya no se puede reservar (primera membresía o fin de la membresía).
  limite: string;
};

// Cliente sin membresía activa: paga la membresía junto con su primera limpieza.
export type CotizacionPrimera = CotizacionComun & {
  modo: "primera";
  membresia: { mensual: number; meses: number; total: number };
};

// Miembro activo: solo paga la limpieza, con el descuento de miembro (reservar-como-miembro-activo, decisión 4).
export type CotizacionMiembro = CotizacionComun & {
  modo: "miembro";
  membresia: null;
  // Fin de la membresía que autoriza la reserva (ISO con zona). El servicio debe empezar antes.
  membresia_fin: string;
  // Falso si el `fin` ya pasó: no hay nada reservable hasta renovar.
  membresia_vigente: boolean;
  // Crédito en horas (ítem 14): el saldo vigente del cliente, lo que se aplicaría a este servicio (`credito_aplicado`, ya en el
  // cálculo) y si no queda nada por pagar gracias a él (el asistente omite el paso de pago y confirma sin comprobante).
  credito_disponible: number;
  cubierta_por_credito: boolean;
};

export type Cotizacion = CotizacionPrimera | CotizacionMiembro;

// Cotización de la primera reserva con membresía: todo lo calcula el servidor, el navegador no recalcula (ADR 0008).
// Función pura sobre la configuración ya leída. La decisión de las horas gratis (cliente y hogar) la toma
// decidirLimpiezaGratis y llega en opciones; sin ella se cotiza el caso del cliente y el hogar nuevos.
export function cotizarPrimeraReserva(
  config: Configuracion,
  servicio: EntradaServicio,
  ahora: Date,
  opciones: { aplicaGratis?: boolean; motivoSinGratis?: MotivoSinGratis | null } = {},
): CotizacionPrimera {
  const aplicaGratis = opciones.aplicaGratis ?? true;
  const calculo = calcularServicio(config, { ...servicio, aplicaGratis });
  const total = config.membresia_precio_mensual * config.membresia_meses;
  const zona = config.horario_atencion.zona;
  const limite = limitePrimeraMembresia(config, ahora);
  const primerInstante = new Date(ahora.getTime() + config.anticipacion_minima_horas * 3_600_000);
  return {
    ...calculo,
    modo: "primera",
    aplica_gratis: aplicaGratis,
    motivo_sin_gratis: aplicaGratis ? null : (opciones.motivoSinGratis ?? null),
    membresia: { mensual: config.membresia_precio_mensual, meses: config.membresia_meses, total },
    total_a_pagar: total + calculo.monto,
    espera_pago_horas: config.espera_pago_horas,
    fechas: { desde: fechaLocal(primerInstante, zona), hasta: fechaLocal(limite, zona) },
    limite: isoConZona(limite, zona),
  };
}

// Rango de días reservables de un miembro: del primer día con la anticipación mínima al último día civil con algún inicio
// anterior al `fin` de su membresía. Si el `fin` no llega ni al primer instante reservable no hay ningún día: `hasta`
// queda un día antes de `desde` y la lista de días sale vacía. Lo usan la cotización y la pantalla del nuevo horario.
export function fechasDeMiembro(
  config: Pick<Configuracion, "anticipacion_minima_horas" | "horario_atencion">,
  ahora: Date,
  fin: Date,
): { desde: string; hasta: string } {
  const zona = config.horario_atencion.zona;
  const primerInstante = new Date(ahora.getTime() + config.anticipacion_minima_horas * 3_600_000);
  const hasta =
    fin.getTime() <= primerInstante.getTime()
      ? fechaLocal(new Date(primerInstante.getTime() - 86_400_000), zona)
      : fechaLocal(new Date(fin.getTime() - 1), zona);
  return { desde: fechaLocal(primerInstante, zona), hasta };
}

// Cotización de un miembro activo. Pura: el `fin` de su membresía y el saldo de crédito (ítem 14) llegan ya leídos. El total es el
// monto de la limpieza (con el descuento de miembro que ya aplica `calcularServicio`), sin la línea de la membresía.
export function cotizarReservaDeMiembro(
  config: Configuracion,
  servicio: EntradaServicio,
  ahora: Date,
  opciones: { aplicaGratis?: boolean; motivoSinGratis?: MotivoSinGratis | null; creditoHoras?: number; membresiaFin: Date },
): CotizacionMiembro {
  const aplicaGratis = opciones.aplicaGratis ?? false;
  const calculo = calcularServicio(config, { ...servicio, aplicaGratis, creditoHoras: opciones.creditoHoras ?? 0 });
  const zona = config.horario_atencion.zona;
  const fin = opciones.membresiaFin;
  return {
    ...calculo,
    modo: "miembro",
    aplica_gratis: aplicaGratis,
    motivo_sin_gratis: aplicaGratis ? null : (opciones.motivoSinGratis ?? null),
    membresia: null,
    membresia_fin: isoConZona(fin, zona),
    membresia_vigente: fin.getTime() > ahora.getTime(),
    credito_disponible: opciones.creditoHoras ?? 0,
    cubierta_por_credito: calculo.credito_aplicado > 0 && calculo.monto === 0,
    total_a_pagar: calculo.monto,
    espera_pago_horas: config.espera_pago_horas,
    fechas: fechasDeMiembro(config, ahora, fin),
    limite: isoConZona(fin, zona),
  };
}
