import type { MotivoSinGratis } from "../gratis";

// Texto para el cliente cuando las 3 horas gratis no aplican. El servidor dice el motivo (`motivo_sin_gratis`);
// aquí solo se redacta. No menciona montos: los muestra la cotización.
export function textoSinGratis(motivo: MotivoSinGratis | null): string | null {
  switch (motivo) {
    case "cliente":
      return "Tu cuenta ya tiene una limpieza gratis reservada o realizada. Esta limpieza se cobra completa, con tu descuento de miembro.";
    case "hogar":
      return "Otra cuenta ya recibió la limpieza gratis de esta dirección. Esta limpieza se cobra completa, con tu descuento de miembro.";
    default:
      return null;
  }
}
