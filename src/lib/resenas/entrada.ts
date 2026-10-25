import { z } from "zod";
import { ErrorApi } from "../errores";

import { COMENTARIO_MAX, COMENTARIO_MIN, largoDelComentario } from "./limites";

export { COMENTARIO_MAX, COMENTARIO_MIN, largoDelComentario };

const MENSAJE_ESTRELLAS = "Elige de 1 a 5 estrellas.";
const MENSAJE_COMENTARIO_CORTO = `Escribe un comentario de al menos ${COMENTARIO_MIN} caracteres.`;
const MENSAJE_COMENTARIO_LARGO = `El comentario puede tener hasta ${COMENTARIO_MAX} caracteres.`;

// Recorta y deja como máximo un salto de línea en blanco entre párrafos (más de dos saltos seguidos pasan a dos).
export function normalizarComentario(texto: string): string {
  return texto.replace(/\r\n?/g, "\n").trim().replace(/\n{3,}/g, "\n\n");
}

export const esquemaResena = z.object({
  estrellas: z.number({ error: MENSAJE_ESTRELLAS }).int({ error: MENSAJE_ESTRELLAS }).min(1, { error: MENSAJE_ESTRELLAS }).max(5, { error: MENSAJE_ESTRELLAS }),
  comentario: z
    .string({ error: MENSAJE_COMENTARIO_CORTO })
    .transform(normalizarComentario)
    .pipe(
      z
        .string()
        .refine((t) => largoDelComentario(t) >= COMENTARIO_MIN, { error: MENSAJE_COMENTARIO_CORTO })
        .refine((t) => largoDelComentario(t) <= COMENTARIO_MAX, { error: MENSAJE_COMENTARIO_LARGO }),
    ),
});

export type CuerpoResena = z.infer<typeof esquemaResena>;

// Valida el cuerpo de POST/PUT. Un mensaje por falla, en español de Perú (422).
export function validarResena(cuerpo: unknown): CuerpoResena {
  const resultado = esquemaResena.safeParse(cuerpo);
  if (resultado.success) return resultado.data;
  throw ErrorApi.invalido(resultado.error.issues[0]?.message ?? "Revisa tu reseña.");
}
