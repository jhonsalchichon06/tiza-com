import { describe, expect, it } from "vitest";
import { COMENTARIO_MAX, COMENTARIO_MIN, esquemaResena, normalizarComentario, validarResena } from "./entrada";

const campoFallido = (cuerpo: unknown) => {
  const r = esquemaResena.safeParse(cuerpo);
  return r.success ? null : r.error.issues[0].path[0];
};
const valido = { estrellas: 5, comentario: "Muy buen servicio, todo quedó impecable." };

describe("esquemaResena", () => {
  it("acepta una reseña válida", () => {
    expect(esquemaResena.parse(valido)).toEqual(valido);
  });

  it.each([0, 6, 3.5, "5", null, undefined, -1])("estrellas %s falla nombrando estrellas", (estrellas) => {
    expect(campoFallido({ ...valido, estrellas })).toBe("estrellas");
  });

  it.each([1, 2, 3, 4, 5])("%s estrellas pasa", (estrellas) => {
    expect(esquemaResena.safeParse({ ...valido, estrellas }).success).toBe(true);
  });

  it("comentarios de 9 y 501 caracteres y solo espacios fallan nombrando comentario", () => {
    expect(campoFallido({ ...valido, comentario: "a".repeat(COMENTARIO_MIN - 1) })).toBe("comentario");
    expect(campoFallido({ ...valido, comentario: "a".repeat(COMENTARIO_MAX + 1) })).toBe("comentario");
    expect(campoFallido({ ...valido, comentario: "          " })).toBe("comentario");
    expect(campoFallido({ ...valido, comentario: 12345 })).toBe("comentario");
    expect(campoFallido({ estrellas: 5 })).toBe("comentario");
  });

  it("10 y 500 caracteres pasan", () => {
    expect(esquemaResena.safeParse({ ...valido, comentario: "a".repeat(COMENTARIO_MIN) }).success).toBe(true);
    expect(esquemaResena.safeParse({ ...valido, comentario: "a".repeat(COMENTARIO_MAX) }).success).toBe(true);
  });

  it("recorta los espacios de alrededor y cuenta después de recortar", () => {
    expect(esquemaResena.parse({ ...valido, comentario: "   Excelente atención   " }).comentario).toBe("Excelente atención");
    expect(campoFallido({ ...valido, comentario: "   corto    " })).toBe("comentario");
  });

  it("un emoji cuenta como un solo carácter", () => {
    // 9 letras + 1 emoji = 10 caracteres (el emoji ocupa dos unidades UTF-16, pero es uno).
    expect(esquemaResena.safeParse({ ...valido, comentario: "abcdefghi😀" }).success).toBe(true);
    // 500 emojis = 500 caracteres.
    expect(esquemaResena.safeParse({ ...valido, comentario: "😀".repeat(COMENTARIO_MAX) }).success).toBe(true);
    expect(esquemaResena.safeParse({ ...valido, comentario: "😀".repeat(COMENTARIO_MAX + 1) }).success).toBe(false);
  });

  it("los saltos de línea repetidos se normalizan a una línea en blanco", () => {
    expect(normalizarComentario("Primera línea\n\n\n\n\nSegunda línea")).toBe("Primera línea\n\nSegunda línea");
    expect(normalizarComentario("Uno\r\nDos")).toBe("Uno\nDos");
  });

  it("ignora campos que no declara (no se puede enviar estado ni revisada_por)", () => {
    expect(esquemaResena.parse({ ...valido, estado: "aprobada", revisada_por: "x" })).toEqual(valido);
  });
});

describe("validarResena", () => {
  it("lanza 422 con un mensaje en español", () => {
    expect(() => validarResena({ ...valido, estrellas: 6 })).toThrowError(expect.objectContaining({ status: 422, message: "Elige de 1 a 5 estrellas." }));
    expect(() => validarResena({ ...valido, comentario: "corto" })).toThrowError(expect.objectContaining({ status: 422 }));
    expect(() => validarResena(null)).toThrowError(expect.objectContaining({ status: 422 }));
  });
});
