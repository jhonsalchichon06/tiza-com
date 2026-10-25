import { servicioDeEstado, sinCosto, type DireccionEscrita, type Estado, type Metodo, type ServicioElegido } from "./estado";

// Cuerpo de POST /api/reservas. No lleva ningún monto, descuento ni horas gratis: los calcula el servidor (ADR 0008).
export type CuerpoDeReserva = {
  servicio: ServicioElegido;
  inicio: string;
  direccion: DireccionEscrita;
  // Ausentes cuando la limpieza no tiene costo (monto 0): el servidor no los pide.
  metodo?: Metodo;
  comprobante?: string;
};

// `inicio` va tal como lo devolvió la disponibilidad (ISO con zona); la dirección va sin normalizar.
export function construirCuerpo(estado: Estado, rutaComprobante: string | null): CuerpoDeReserva {
  const servicio = servicioDeEstado(estado);
  const gratis = sinCosto(estado);
  if (!servicio || !estado.horario || (!gratis && (!estado.metodo || !rutaComprobante))) {
    throw new Error("Faltan datos para armar la reserva.");
  }
  const d = estado.direccion;
  return {
    servicio,
    inicio: estado.horario.inicio,
    direccion: { distrito: d.distrito, calle: d.calle, numero: d.numero, departamento: d.departamento, referencias: d.referencias },
    ...(gratis ? {} : { metodo: estado.metodo as Metodo, comprobante: rutaComprobante as string }),
  };
}
