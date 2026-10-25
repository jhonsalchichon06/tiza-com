// Qué muestra /reservar según la sesión y las membresías del cliente. Función pura: la página del servidor
// consulta la base y le pasa los estados y la vigencia (calculada por la base con `fin > now()`).

export type EstadoDeMembresia = "pendiente" | "activa" | "caducada";
export type MembresiaParaVista = { estado: EstadoDeMembresia; vigente: boolean };
export type Vista = "redirigir" | "pago_en_revision" | "membresia_vencida" | "miembro" | "asistente";

// - `miembro`: tiene una `activa` vigente (aunque haya otra pendiente): el asistente en modo miembro.
// - `pago_en_revision`: no es miembro vigente y tiene un pago pendiente (la primera membresía o la renovación).
// - `membresia_vencida`: su única `activa` ya venció: "Tu membresía venció", sin asistente.
// - `asistente`: sin membresía; el asistente de la primera membresía.
// Una `caducada` (venció el plazo para reenviar el comprobante) no cuenta: el cliente empieza de nuevo.
export function decidirVista(usuario: { id: string } | null, membresias: readonly MembresiaParaVista[]): Vista {
  if (!usuario) return "redirigir";
  if (membresias.some((m) => m.estado === "activa" && m.vigente)) return "miembro";
  if (membresias.some((m) => m.estado === "pendiente")) return "pago_en_revision";
  if (membresias.some((m) => m.estado === "activa")) return "membresia_vencida";
  return "asistente";
}
