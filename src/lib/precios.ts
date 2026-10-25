import { z } from "zod";
import type { Configuracion } from "./configuracion";
import { validar } from "./validacion-sesion";
import { ErrorApi } from "./errores";

// Cálculo de duración y precio de un servicio (ADR 0008 y 0012). Función pura: recibe la configuración
// ya leída y no toca la base, el reloj ni el entorno. Los montos van en céntimos enteros.

const horasCredito = z
  .number({ error: "Las horas de crédito no son válidas." })
  .min(0, { error: "Las horas de crédito no pueden ser negativas." })
  .multipleOf(0.5, { error: "Las horas de crédito deben ir de media en media hora." });

const comunes = {
  // Qué cuenta como limpieza gratis (#9, #10) y cuánto crédito hay (#14) lo deciden otros ítems: aquí llegan como datos.
  aplicaGratis: z.boolean({ error: "Indica si aplica la limpieza gratis." }).default(false),
  creditoHoras: horasCredito.default(0),
};

const porTamano = (tipo: "estandar" | "profunda" | "mudanza") =>
  z.object({
    tipo: z.literal(tipo),
    dormitorios: z
      .number({ error: "Indica cuántos dormitorios tiene el hogar." })
      .int({ error: "Los dormitorios deben ser un número entero." })
      .min(0, { error: "Los dormitorios no pueden ser negativos." }),
    banos: z
      .number({ error: "Indica cuántos baños tiene el hogar." })
      .int({ error: "Los baños deben ser un número entero." })
      .min(1, { error: "El hogar debe tener al menos 1 baño." }),
    ...comunes,
  });

const esquemaEntrada = z.discriminatedUnion(
  "tipo",
  [
    porTamano("estandar"),
    porTamano("profunda"),
    porTamano("mudanza"),
    z.object({
      tipo: z.literal("paquete"),
      horas: z.number({ error: "Indica las horas del paquete." }),
      ...comunes,
    }),
  ],
  { error: "Elige un tipo de servicio válido." },
);

export type EntradaServicio = z.input<typeof esquemaEntrada>;

export type ResultadoServicio = {
  nivel: number | null; // 1 a N por tamaño; null en un paquete por horas
  horas_trabajo: number; // de 1 persona; sobre ellas se cuentan el precio, las horas gratis y el crédito
  horas_agenda: number; // lo que ocupa en la agenda (sin el traslado)
  requiere_apoyo: boolean;
  precio_lista: number;
  horas_gratis_aplicadas: number;
  credito_aplicado: number;
  horas_cobrar: number;
  subtotal: number; // lo que cuestan las horas a cobrar, sin descuento
  descuento: number; // descuento de miembro: subtotal − monto
  monto: number; // lo que paga el cliente
};

// Redondea al entero más cercano (mitades hacia arriba) sin arrastrar ruido de punto flotante.
const redondear = (x: number) => Math.round(Math.round(x * 1e6) / 1e6);

// num/den redondeado a entero, mitades hacia arriba, solo con enteros.
const dividirRedondeando = (num: number, den: number) => Math.floor((2 * num + den) / (2 * den));

export function calcularServicio(config: Configuracion, entrada: EntradaServicio): ResultadoServicio {
  const e = validar(esquemaEntrada, entrada);

  let nivel: number | null = null;
  let horasTrabajo: number;
  let precioLista: number;
  let requiereApoyo = false;

  if (e.tipo === "paquete") {
    const paquete = config.paquetes_horas.find((p) => p.horas === e.horas);
    if (!paquete) throw ErrorApi.invalido("Ese paquete de horas no existe.");
    horasTrabajo = paquete.horas;
    precioLista = paquete.precio;
  } else {
    const indice = config.niveles_hogar.findIndex(
      (n) =>
        (n.max_dormitorios === null || e.dormitorios <= n.max_dormitorios) &&
        (n.max_banos === null || e.banos <= n.max_banos),
    );
    // El último nivel no tiene máximo (lo comprueba la configuración), así que siempre hay uno.
    if (indice < 0) throw new Error("La configuración no tiene un nivel sin máximo para el hogar.");
    nivel = indice + 1;
    horasTrabajo = config.niveles_hogar[indice].horas + config.horas_extra_tipo[e.tipo];
    precioLista = redondear(config.precios_niveles[indice] * config.multiplicadores_precio[e.tipo]);
    requiereApoyo = horasTrabajo > config.apoyo_extra.umbral_horas;
  }

  // Con apoyo, la mitad (factor) del tiempo, redondeada hacia arriba al intervalo de horarios.
  const intervalo = config.intervalo_horarios_minutos;
  const minutosAgenda = requiereApoyo
    ? Math.ceil((horasTrabajo * 60 * config.apoyo_extra.factor_agenda) / intervalo - 1e-9) * intervalo
    : horasTrabajo * 60;

  // Primero las horas gratis y después el crédito (ADR 0012); siempre en horas de trabajo, nunca de agenda.
  const horasGratis = e.aplicaGratis ? Math.min(config.horas_gratis, horasTrabajo) : 0;
  const credito = Math.min(e.creditoHoras, horasTrabajo - horasGratis);
  const horasCobrar = horasTrabajo - horasGratis - credito;

  // Todas las horas son múltiplos de 0,5: se calcula en medias horas enteras y con el descuento en diezmilésimos.
  const trabajo2 = horasTrabajo * 2;
  const cobrar2 = horasCobrar * 2;
  const descuentoBp = Math.round(config.descuento_miembro * 10000);
  const subtotal = dividirRedondeando(precioLista * cobrar2, trabajo2);
  const monto = dividirRedondeando(precioLista * cobrar2 * (10000 - descuentoBp), trabajo2 * 10000);

  return {
    nivel,
    horas_trabajo: horasTrabajo,
    horas_agenda: minutosAgenda / 60,
    requiere_apoyo: requiereApoyo,
    precio_lista: precioLista,
    horas_gratis_aplicadas: horasGratis,
    credito_aplicado: credito,
    horas_cobrar: horasCobrar,
    subtotal,
    descuento: subtotal - monto,
    monto,
  };
}
