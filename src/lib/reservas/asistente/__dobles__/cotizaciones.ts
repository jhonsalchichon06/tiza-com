// Cotizaciones reales calculadas con los valores del diseño, para las pruebas del asistente (no son datos del producto).
import { VALORES_DEL_DISENO } from "../../../__fixtures__/configuracion";
import { instanteLocal } from "../../../agenda/horario";
import { cotizarPrimeraReserva, cotizarReservaDeMiembro } from "../../cotizar";
import type { RespuestaDeReserva, RespuestaReserva } from "../../crear";
import type { ServicioElegido } from "../estado";

export const AHORA_DE_PRUEBA = instanteLocal("2026-11-02", "10:00", "America/Lima"); // lunes

export const cotizacionDe = (servicio: ServicioElegido) => cotizarPrimeraReserva(VALORES_DEL_DISENO, servicio, AHORA_DE_PRUEBA);

export const PROFUNDA_2_1 = () => cotizacionDe({ tipo: "profunda", dormitorios: 2, banos: 1 });
export const PROFUNDA_3_2 = () => cotizacionDe({ tipo: "profunda", dormitorios: 3, banos: 2 });
export const ESTANDAR_0_1 = () => cotizacionDe({ tipo: "estandar", dormitorios: 0, banos: 1 });

export const PAQUETES_DE_PRUEBA = VALORES_DEL_DISENO.paquetes_horas.map((p) => p.horas);

export const RESPUESTA_201: RespuestaReserva = {
  reserva: {
    id: "r1",
    estado: "pendiente",
    servicio: { tipo: "profunda", dormitorios: 2, banos: 1 },
    inicio: "2026-11-09T09:00:00-05:00",
    fin: "2026-11-09T14:00:00-05:00",
    expira_en: "2026-11-03T10:00:00-05:00",
    monto: 6966,
    precio_lista: 19350,
    horas_gratis_aplicadas: 3,
    requiere_apoyo: false,
  },
  membresia: { id: "m1", estado: "pendiente", monto: 26700 },
  pago: { id: "p1", concepto: "membresia_y_reserva", monto: 33666, metodo: "yape", estado: "pendiente" },
  whatsapp: "https://wa.me/51999999999?text=Hola",
};

// Cotización de un miembro activo (modo miembro): sin membresía en el total y con límite en el fin de la membresía.
export const FIN_DE_MEMBRESIA_DE_PRUEBA = instanteLocal("2027-01-20", "10:00", "America/Lima");

export const cotizacionDeMiembro = (servicio: ServicioElegido, opciones: { aplicaGratis?: boolean; membresiaFin?: Date; creditoHoras?: number } = {}) =>
  cotizarReservaDeMiembro(VALORES_DEL_DISENO, servicio, AHORA_DE_PRUEBA, {
    aplicaGratis: opciones.aplicaGratis,
    creditoHoras: opciones.creditoHoras,
    membresiaFin: opciones.membresiaFin ?? FIN_DE_MEMBRESIA_DE_PRUEBA,
  });

// Miembro con la primera cancelada y un servicio de 3 horas: las 3 horas gratis cubren todo (monto 0).
export const MIEMBRO_SIN_COSTO = () => cotizacionDeMiembro({ tipo: "estandar", dormitorios: 1, banos: 1 }, { aplicaGratis: true });
// Miembro con 2 horas de crédito: paga las otras 2 (cobertura parcial).
export const MIEMBRO_CREDITO_PARCIAL = () => cotizacionDeMiembro({ tipo: "estandar", dormitorios: 2, banos: 1 }, { creditoHoras: 2 });
// Miembro cuyo crédito cubre toda la limpieza de 4 horas (sin costo, sin comprobante).
export const MIEMBRO_CREDITO_CUBRE = () => cotizacionDeMiembro({ tipo: "estandar", dormitorios: 2, banos: 1 }, { creditoHoras: 6 });
// Miembro que paga la limpieza completa con su descuento.
export const MIEMBRO_ESTANDAR_2_1 = () => cotizacionDeMiembro({ tipo: "estandar", dormitorios: 2, banos: 1 });

export const RESPUESTA_MIEMBRO_201: RespuestaDeReserva = {
  reserva: { ...RESPUESTA_201.reserva, monto: 11610, precio_lista: 12900, horas_gratis_aplicadas: 0 },
  membresia: null,
  pago: { id: "p2", concepto: "reserva", monto: 11610, metodo: "yape", estado: "pendiente" },
  whatsapp: "https://wa.me/51999999999?text=Hola",
};

export const RESPUESTA_MIEMBRO_CONFIRMADA: RespuestaDeReserva = {
  reserva: { ...RESPUESTA_201.reserva, estado: "confirmada", expira_en: null, monto: 0, precio_lista: 9900, horas_gratis_aplicadas: 3 },
  membresia: null,
  pago: { id: "p3", concepto: "reserva", monto: 0, metodo: "credito", estado: "aprobado" },
  whatsapp: null,
};
