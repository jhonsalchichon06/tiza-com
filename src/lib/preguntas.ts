import type { Catalogo } from "./catalogo-publico";

export type Pregunta = { pregunta: string; respuesta: string };

// Preguntas frecuentes (PRD, alcance 11). Toda cifra sale del catálogo, que sale de `configuracion`.
// Excepción: el plazo de cancelar o reprogramar ("24 horas antes") no es un parámetro todavía (lo definirá el ítem #12).
// Sin monto de la membresía (ni mensual ni total) ni de la renovación: siguen sin confirmar.
export function construirPreguntas(c: Catalogo): Pregunta[] {
  const descuento = `${c.descuentoPorcentaje}%`;
  return [
    {
      pregunta: `¿Cómo funcionan las ${c.horasGratisTexto} gratis?`,
      respuesta: `Al activar Tiza Club, las primeras ${c.horasGratisTexto} de tu primera limpieza son gratis. Si tu servicio dura más, solo pagas las horas adicionales, con ${descuento} de descuento de miembro. El beneficio es uno por cliente y por hogar, y la renovación de la membresía no da otra limpieza gratis.`,
    },
    {
      pregunta: "¿Qué incluye la membresía Tiza Club?",
      respuesta: `Son ${c.membresia.mesesTexto} en un solo pago por adelantado. Incluye la primera limpieza con ${c.horasGratisTexto} gratis y ${descuento} de descuento en tus siguientes limpiezas. El pago no se reembolsa ni se puede cancelar antes de los ${c.membresia.mesesTexto}. Los ${c.membresia.mesesTexto} cuentan desde que aprobamos tu pago.`,
    },
    {
      pregunta: "¿Qué es mejor: por horas o por tamaño de casa?",
      respuesta:
        "Por tamaño es ideal si quieres una limpieza completa y precio cerrado según los dormitorios y baños de tu hogar. Por horas te da control: tú nos dices qué limpiar y el profesional trabaja el tiempo que elijas.",
    },
    {
      pregunta: "¿Cómo pago?",
      respuesta: `Por adelantado, con Yape (te mostramos el código QR) o transferencia (te mostramos la CCI). Subes una imagen del comprobante en tu cuenta y nuestro equipo lo revisa y lo aprueba o lo rechaza. Tu reserva queda en espera hasta la aprobación, por un máximo de ${c.esperaPagoTexto}.`,
    },
    {
      pregunta: "¿Con cuánta anticipación debo reservar y en qué horario atienden?",
      respuesta: `Reserva con al menos ${c.anticipacionTexto} de anticipación. Atendemos ${c.horario}.`,
    },
    {
      pregunta: "¿Puedo reprogramar o cancelar?",
      respuesta: `Sí, hasta 24 horas antes de tu cita. Si ya pagaste, no devolvemos dinero: las horas pagadas quedan como crédito para tu siguiente limpieza durante ${c.creditoVigenciaTexto}.`,
    },
    {
      pregunta: `¿Qué pasa cuando terminan los ${c.membresia.mesesTexto}?`,
      respuesta:
        "Tu perfil te avisa que debes pagar de nuevo para seguir reservando. La renovación no es automática: sin un nuevo pago aprobado no podrás elegir día y hora para nuevas limpiezas.",
    },
    {
      pregunta: "¿En qué distritos atienden?",
      respuesta: `Por ahora atendemos ${c.distritos.length} distritos de Lima: ${c.distritos.slice(0, -1).join(", ")} y ${c.distritos[c.distritos.length - 1]}.`,
    },
    {
      pregunta: "¿Qué pasa con las casas muy grandes?",
      respuesta: `Si el servicio por tamaño de tu hogar requiere más de ${c.umbralApoyoTexto} de trabajo, va una segunda persona de apoyo y la limpieza ocupa menos tiempo en la agenda. El precio es el mismo con o sin apoyo.`,
    },
    {
      pregunta: "¿Necesito estar en casa durante la limpieza?",
      respuesta: "No es obligatorio. Puedes dejar acceso con portería o un familiar.",
    },
    {
      pregunta: "¿Ustedes traen los productos y equipos?",
      respuesta: "Sí. Llevamos aspiradora, productos y todo lo necesario. Si prefieres usar los tuyos, solo avísanos.",
    },
  ];
}
