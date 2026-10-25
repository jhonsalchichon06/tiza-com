import type { Configuracion } from "../configuracion";

// Valores del diseño (openspec/changes/base-del-proyecto/design.md, decisión 2).
export const VALORES_DEL_DISENO: Configuracion = {
  niveles_hogar: [
    { max_dormitorios: 0, max_banos: 1, horas: 2 },
    { max_dormitorios: 1, max_banos: 1, horas: 3 },
    { max_dormitorios: 2, max_banos: 2, horas: 4 },
    { max_dormitorios: null, max_banos: null, horas: 6 },
  ],
  precios_niveles: [6600, 9900, 12900, 18900],
  horas_extra_tipo: { estandar: 0, profunda: 1, mudanza: 2 },
  multiplicadores_precio: { estandar: 1, profunda: 1.5, mudanza: 1.7 },
  paquetes_horas: [
    { horas: 3, precio: 9900 },
    { horas: 4, precio: 12900 },
    { horas: 6, precio: 18900 },
    { horas: 8, precio: 23900 },
  ],
  apoyo_extra: { umbral_horas: 6, factor_agenda: 0.5 },
  membresia_precio_mensual: 8900,
  membresia_meses: 3,
  horas_gratis: 3,
  descuento_miembro: 0.1,
  anticipacion_minima_horas: 48,
  espera_pago_horas: 24,
  traslado_horas: 1,
  intervalo_horarios_minutos: 30,
  credito_vence_meses: 3,
  reenvio_comprobante_dias: 7,
  cancelacion_minima_horas: 24,
  renovacion_aviso_dias: 14,
  fotos_maximas_por_reserva: 12,
  horario_atencion: { dias: [1, 2, 3, 4, 5, 6], apertura: "08:00", cierre: "18:00", zona: "America/Lima" },
};
