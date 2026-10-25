import { describe, expect, it } from "vitest";
import { ErrorApi } from "../errores";
import { validar } from "../validacion-sesion";
import { crearEsquemaFotos } from "./esquema-entrada";

const foto = (n = 1, ambiente = "cocina") => ({ ruta: `fotos/r/${n}.webp`, ambiente });
const error = (cuerpo: unknown, max = 12) => {
  try {
    validar(crearEsquemaFotos(max), cuerpo);
  } catch (e) {
    return e as ErrorApi;
  }
  return null;
};

describe("esquema del cuerpo de fotos", () => {
  it("acepta de 1 a max fotos", () => {
    expect(error({ fotos: [foto()] })).toBeNull();
    expect(error({ fotos: Array.from({ length: 12 }, (_, i) => foto(i)) })).toBeNull();
  });

  it.each([
    ["lista vacía", { fotos: [] }],
    ["sin fotos", {}],
    ["fotos que no es lista", { fotos: "x" }],
    ["cuerpo que no es objeto", "hola"],
    ["sin ruta", { fotos: [{ ambiente: "cocina" }] }],
    ["ruta vacía", { fotos: [{ ruta: "", ambiente: "cocina" }] }],
    ["sin ambiente", { fotos: [{ ruta: "fotos/r/1.webp" }] }],
    ["ambiente garaje", { fotos: [foto(1, "garaje")] }],
    ["13 con límite 12", { fotos: Array.from({ length: 13 }, (_, i) => foto(i)) }],
  ])("%s: 422", (_nombre, cuerpo) => {
    const e = error(cuerpo);
    expect(e).toBeInstanceOf(ErrorApi);
    expect(e?.status).toBe(422);
  });

  it("el máximo viene del parámetro: con 5, seis se rechazan y el mensaje lo nombra", () => {
    const e = error({ fotos: Array.from({ length: 6 }, (_, i) => foto(i)) }, 5);
    expect(e?.status).toBe(422);
    expect(e?.message).toContain("5");
  });

  it("los mensajes están en español", () => {
    expect(error({ fotos: [] })?.message).toBe("Envía al menos una foto.");
    expect(error({ fotos: [foto(1, "garaje")] })?.message).toBe("Elige el ambiente de cada foto.");
    expect(error({ fotos: [{ ambiente: "sala" }] })?.message).toBe("La ruta de la foto no es válida.");
  });

  it("ignora claves que no declara", () => {
    const r = validar(crearEsquemaFotos(12), { fotos: [{ ...foto(), subida_por: "otro", reservaId: "x" }], extra: 1 });
    expect(r).toEqual({ fotos: [foto()] });
  });
});
