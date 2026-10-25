import { formatearFecha } from "../perfil/textos";
import { formatearHoras } from "../soles";

// Mensajes del crédito en horas en español de Perú (ADR 0012). Funciones puras: las fechas van en la zona de atención.

export function mensajeCreditoGenerado({ horas, venceEn, zona }: { horas: number; venceEn: Date | string; zona: string }): string {
  return `Te devolvimos ${formatearHoras(horas)} como crédito. Puedes usarlas hasta el ${formatearFecha(venceEn, zona)}.`;
}

// El pago aún no se aprobó: el crédito aparece cuando el administrador lo apruebe.
export function mensajeCreditoPendiente(): string {
  return "Si se aprueba tu pago, las horas quedarán como crédito.";
}

export function mensajeCreditoDevuelto({ horas }: { horas: number }): string {
  return `Las ${formatearHoras(horas)} de crédito que usabas volvieron a tu saldo, con su fecha de vencimiento original.`;
}

export function mensajeCreditoCubre({ horas }: { horas: number }): string {
  return `Tu crédito de ${formatearHoras(horas)} cubre esta limpieza.`;
}

export function mensajeCreditoParcial({ horas }: { horas: number }): string {
  return `Usaremos ${formatearHoras(horas)} de tu crédito.`;
}

export { formatearHoras };

// Mensajes de la pantalla al cancelar, a partir de la respuesta del servidor. Varios pueden aplicar a la vez.
export function mensajesDeCancelacion({
  credito,
  horasPagadas,
  estadoPago,
  zona,
}: {
  credito: { generado_horas: number; vence_en: string | null; devuelto_horas: number } | null | undefined;
  horasPagadas: number;
  estadoPago: "pendiente" | "aprobado" | "rechazado" | null;
  zona: string;
}): string[] {
  const mensajes: string[] = [];
  if (credito && credito.generado_horas > 0 && credito.vence_en) {
    mensajes.push(mensajeCreditoGenerado({ horas: credito.generado_horas, venceEn: credito.vence_en, zona }));
  } else if (estadoPago === "pendiente" && horasPagadas > 0) {
    mensajes.push(mensajeCreditoPendiente());
  }
  if (credito && credito.devuelto_horas > 0) mensajes.push(mensajeCreditoDevuelto({ horas: credito.devuelto_horas }));
  return mensajes;
}
