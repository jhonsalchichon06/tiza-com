const MENSAJE = "Hola Tiza, quiero cotizar una limpieza";

// Enlace de WhatsApp con mensaje prellenado. Sin número o con algo que no sean dígitos, no hay enlace.
export function enlaceWhatsApp(numero: string | undefined, mensaje: string = MENSAJE): string | null {
  const limpio = numero?.trim();
  if (!limpio || !/^\d+$/.test(limpio)) return null;
  return `https://wa.me/${limpio}?text=${encodeURIComponent(mensaje)}`;
}
