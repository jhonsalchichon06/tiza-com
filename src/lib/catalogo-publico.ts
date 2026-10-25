import type { Configuracion } from "./configuracion";
import { DISTRITOS } from "./distritos";
import { describirHorario, formatearHoras, formatearSoles } from "./formato-publico";
import { calcularServicio } from "./precios";

// Todo lo que muestran las páginas públicas, calculado desde `configuracion` (ADR 0008). Función pura.
// No incluye el monto de la membresía: sigue sin confirmar (PRD, REVISAR) y se muestra al pagar.

export type TipoPorTamano = "estandar" | "profunda" | "mudanza";

export type ServicioDesde = {
  tipo: TipoPorTamano;
  desdeCentimos: number;
  desde: string;
  horasTrabajo: number;
  horas: string;
};

export type PaqueteHoras = {
  horas: number;
  horasTexto: string;
  precio: string;
  precioPorHora: string;
  descripcion: string;
  mejorPrecio: boolean;
};

export type Catalogo = {
  servicios: ServicioDesde[];
  paquetes: PaqueteHoras[];
  membresia: { meses: number; mesesTexto: string };
  horasGratis: number;
  horasGratisTexto: string;
  descuentoPorcentaje: number;
  creditoVigenciaTexto: string;
  esperaPagoTexto: string;
  anticipacionTexto: string;
  umbralApoyoTexto: string;
  horario: string;
  distritos: readonly string[];
};

const TIPOS: TipoPorTamano[] = ["estandar", "profunda", "mudanza"];

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

const meses = (n: number) => `${n} ${n === 1 ? "mes" : "meses"}`;

function describirPaquete(config: Configuracion, horas: number): string {
  const niveles = config.niveles_hogar;
  const i = niveles.findIndex((n) => n.horas === horas);
  if (i < 0) return "Día completo para casas grandes u orden total.";
  const n = niveles[i];
  if (n.max_dormitorios === null || n.max_banos === null) {
    const previo = niveles[i - 1];
    if (!previo || previo.max_dormitorios === null || previo.max_banos === null) {
      return "Cocina y hogares grandes.";
    }
    return `Cocina y más de ${plural(previo.max_dormitorios, "dormitorio", "dormitorios")} o más de ${plural(previo.max_banos, "baño", "baños")}.`;
  }
  const dormitorios =
    n.max_dormitorios === 0 ? "sin dormitorios" : `hasta ${plural(n.max_dormitorios, "dormitorio", "dormitorios")}`;
  return `Cocina, hasta ${plural(n.max_banos, "baño", "baños")} y ${dormitorios}.`;
}

export function construirCatalogo(config: Configuracion): Catalogo {
  const servicios = TIPOS.map((tipo) => {
    // El hogar más pequeño que acepta calcularServicio; no se repiten multiplicaciones aquí.
    const r = calcularServicio(config, { tipo, dormitorios: 0, banos: 1 });
    return {
      tipo,
      desdeCentimos: r.precio_lista,
      desde: formatearSoles(r.precio_lista),
      horasTrabajo: r.horas_trabajo,
      horas: formatearHoras(r.horas_trabajo),
    };
  });

  // Menor precio por hora, comparado sin dividir (precio_a / horas_a < precio_b / horas_b).
  const lista = config.paquetes_horas;
  const menor = lista.reduce((m, p) => (p.precio * m.horas < m.precio * p.horas ? p : m), lista[0]);
  const unico = lista.filter((p) => p.precio * menor.horas === menor.precio * p.horas).length === 1;
  const paquetes = lista.map((p) => ({
    horas: p.horas,
    horasTexto: formatearHoras(p.horas),
    precio: formatearSoles(p.precio),
    precioPorHora: formatearSoles(p.precio / p.horas),
    descripcion: describirPaquete(config, p.horas),
    mejorPrecio: lista.length > 1 && unico && p === menor,
  }));

  return {
    servicios,
    paquetes,
    membresia: { meses: config.membresia_meses, mesesTexto: meses(config.membresia_meses) },
    horasGratis: config.horas_gratis,
    horasGratisTexto: formatearHoras(config.horas_gratis),
    descuentoPorcentaje: Math.round(config.descuento_miembro * 100),
    creditoVigenciaTexto: meses(config.credito_vence_meses),
    esperaPagoTexto: formatearHoras(config.espera_pago_horas),
    anticipacionTexto: formatearHoras(config.anticipacion_minima_horas),
    umbralApoyoTexto: formatearHoras(config.apoyo_extra.umbral_horas),
    horario: describirHorario(config.horario_atencion),
    distritos: DISTRITOS,
  };
}
