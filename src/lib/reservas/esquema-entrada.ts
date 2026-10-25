import { z } from "zod";

// Cuerpo de POST /api/reservas. Los montos, descuentos y horas gratis NO forman parte: los calcula el servidor
// (ADR 0008). Zod descarta las claves que no declara, así que un `monto` enviado se ignora.

const entero = (falta: string) => z.number({ error: falta }).int({ error: falta });

const servicioPorTamano = z.object({
  tipo: z.enum(["estandar", "profunda", "mudanza"]),
  dormitorios: entero("Indica cuántos dormitorios tiene el hogar."),
  banos: entero("Indica cuántos baños tiene el hogar."),
});

const servicioPaquete = z.object({
  tipo: z.literal("paquete"),
  horas: entero("Indica las horas del paquete."),
});

const servicio = z.discriminatedUnion("tipo", [servicioPorTamano, servicioPaquete], { error: "Elige un tipo de servicio válido." });

export const esquemaReserva = z.object({
  servicio,
  inicio: z
    .string({ error: "Elige el día y la hora de tu limpieza." })
    .max(40, { error: "El día y la hora no son válidos." })
    .pipe(z.iso.datetime({ offset: true, error: "El día y la hora no son válidos." })),
  // Se valida después con `validarDireccion` (ítem #7): aquí solo debe existir.
  direccion: z.unknown(),
  metodo: z.enum(["yape", "transferencia"], { error: "Elige cómo vas a pagar: Yape o transferencia." }),
  comprobante: z
    .string({ error: "Sube el comprobante de tu pago para continuar." })
    .min(1, { error: "Sube el comprobante de tu pago para continuar." })
    .max(300, { error: "La ruta del comprobante no es válida." }),
});

// Cuerpo de un miembro activo: igual, pero el método y el comprobante son opcionales porque el monto solo se conoce dentro de
// la transacción (depende de la limpieza gratis y del crédito). Con monto mayor que 0 la ruta los exige (422 comprobante_requerido).
export const esquemaReservaMiembro = esquemaReserva.extend({
  metodo: esquemaReserva.shape.metodo.optional(),
  comprobante: esquemaReserva.shape.comprobante.optional(),
});

export type CuerpoReservaMiembro = z.infer<typeof esquemaReservaMiembro>;
export type CuerpoReserva = z.infer<typeof esquemaReserva>;
export type ServicioDelCuerpo = CuerpoReserva["servicio"];
