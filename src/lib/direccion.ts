import { z } from "zod";
import { esDistrito, type Distrito } from "./distritos";
import { validar } from "./validacion-sesion";

// Abreviaturas que se unifican, palabra por palabra (ADR 0013). Ampliar la lista es una decisión de negocio.
const ABREVIATURAS: Record<string, string> = {
  av: "avenida",
  avda: "avenida",
  jr: "jiron",
  dpto: "dpto",
  dep: "dpto",
  depto: "dpto",
  departamento: "dpto",
};

// Minúsculas, sin tildes, "n°"/"nº"/"#" como "nro" y solo letras y dígitos separados por un espacio.
function palabras(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/n[°º]|#/g, " nro ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

// Para la calle y el departamento.
export function normalizarTexto(texto: string): string {
  return palabras(texto)
    .map((p) => ABREVIATURAS[p] ?? p)
    .join(" ");
}

// "N° 123 A" y "123-A" dan "123a".
export function normalizarNumero(numero: string): string {
  const p = palabras(numero);
  if (p[0] === "nro") p.shift();
  return p.join("");
}

// `falta` es el mensaje cuando el dato ni siquiera llega (campo ausente o de otro tipo).
const texto = (falta: string, max: number, mensaje: string) => z.string({ error: falta }).max(max, { error: mensaje });

export const esquemaDireccion = z.object({
  distrito: z
    .string({ error: "Elige uno de los distritos que atendemos." })
    .trim()
    .refine(esDistrito, { error: "Elige uno de los distritos que atendemos." }),
  calle: texto("Escribe la calle, avenida o jirón.", 100, "La calle es demasiado larga.")
    .trim()
    .min(1, { error: "Escribe la calle, avenida o jirón." })
    .refine((v) => normalizarTexto(v) !== "", { error: "Escribe la calle, avenida o jirón." }),
  numero: texto("Escribe el número de la casa o del edificio.", 20, "El número es demasiado largo.")
    .trim()
    .min(1, { error: "Escribe el número de la casa o del edificio." })
    .refine((v) => /\d/.test(v), { error: "Escribe un número con al menos un dígito, por ejemplo 123 o 123-A." }),
  departamento: texto("Revisa el departamento.", 30, "El departamento es demasiado largo.").trim().nullish(),
  referencias: texto("Revisa las referencias.", 200, "Las referencias son demasiado largas.").trim().nullish(),
});

export type Direccion = {
  distrito: Distrito;
  calle: string;
  numero: string;
  departamento: string | null;
  referencias: string | null;
  direccionNormalizada: string;
  departamentoNormalizado: string;
};

export type ClaveHogar = Pick<Direccion, "distrito" | "direccionNormalizada" | "departamentoNormalizado">;

// Valida lo que llega del navegador; ante el primer error responde 422 con su mensaje en español.
// La clave del hogar la calcula solo el servidor: el navegador no repite la normalización.
export function validarDireccion(cuerpo: unknown): Direccion {
  const d = validar(esquemaDireccion, cuerpo);
  return {
    distrito: d.distrito as Distrito,
    calle: d.calle,
    numero: d.numero,
    departamento: d.departamento || null,
    referencias: d.referencias || null,
    direccionNormalizada: `${normalizarTexto(d.calle)} ${normalizarNumero(d.numero)}`,
    departamentoNormalizado: d.departamento ? normalizarTexto(d.departamento) : "",
  };
}

// Las referencias no cuentan: son solo para el personal.
export function claveHogar(d: ClaveHogar): ClaveHogar {
  return { distrito: d.distrito, direccionNormalizada: d.direccionNormalizada, departamentoNormalizado: d.departamentoNormalizado };
}
