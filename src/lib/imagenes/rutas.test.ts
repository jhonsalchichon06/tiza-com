import { describe, expect, it } from "vitest";
import { ErrorApi } from "../errores";
import { carpetaPermitida, validarRutaSubida, type UsuarioImagen } from "./rutas";

const cliente: UsuarioImagen = { id: "u-ana", rol: "cliente" };
const admin: UsuarioImagen = { id: "u-admin", rol: "admin" };

const errorDe = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("no lanzó");
};

describe("carpetaPermitida", () => {
  it("el comprobante va en la carpeta del propio usuario", () => {
    expect(carpetaPermitida(cliente, "comprobante")).toBe("comprobantes/u-ana/");
    expect(carpetaPermitida(admin, "comprobante")).toBe("comprobantes/u-admin/");
  });

  it("las fotos son solo del administrador y llevan la reserva", () => {
    expect(carpetaPermitida(admin, "foto", "res_123")).toBe("fotos/res_123/");
    expect(errorDe(() => carpetaPermitida(cliente, "foto", "res_123")).status).toBe(403);
  });

  it.each([[undefined], [""], ["a/b"], [".."], ["x".repeat(65)]])("rechaza el id de reserva %j con 422", (reservaId) => {
    expect(errorDe(() => carpetaPermitida(admin, "foto", reservaId as string)).status).toBe(422);
  });
});

describe("validarRutaSubida", () => {
  const validar = (ruta: unknown, usuario = cliente) => validarRutaSubida({ ruta, usuario });

  it("acepta un archivo en la carpeta propia", () => {
    expect(validar("comprobantes/u-ana/yape.webp")).toEqual({
      tipo: "comprobante",
      carpeta: "comprobantes/u-ana/",
      nombre: "yape.webp",
      reservaId: undefined,
    });
  });

  it.each(["a.jpg", "a.JPEG", "a.png", "A.WebP", "mi foto (1).jpg"])("acepta el nombre %j", (nombre) => {
    expect(validar(`comprobantes/u-ana/${nombre}`).nombre).toBe(nombre);
  });

  it("el administrador sube fotos a la carpeta de una reserva", () => {
    expect(validar("fotos/res_1/cocina.jpg", admin)).toMatchObject({ tipo: "foto", reservaId: "res_1", carpeta: "fotos/res_1/" });
  });

  it("un cliente que pide la carpeta de fotos recibe 403", () => {
    expect(errorDe(() => validar("fotos/res_1/cocina.jpg")).status).toBe(403);
  });

  it("la carpeta de otro usuario da 422", () => {
    const error = errorDe(() => validar("comprobantes/u-otro/yape.webp"));
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error.status).toBe(422);
  });

  it("un administrador tampoco sube a la carpeta de comprobantes de otro", () => {
    expect(errorDe(() => validar("comprobantes/u-ana/yape.webp", admin)).status).toBe(422);
  });

  it.each([
    ["recorrido con ..", "comprobantes/u-ana/../u-otro/a.jpg"],
    ["subcarpeta", "comprobantes/u-ana/sub/a.jpg"],
    ["barra invertida", "comprobantes/u-ana/a\\b.jpg"],
    ["carácter de control", "comprobantes/u-ana/a\u0000.jpg"],
    ["salto de línea", "comprobantes/u-ana/a\n.jpg"],
    ["nombre vacío", "comprobantes/u-ana/"],
    ["solo la extensión", "comprobantes/u-ana/.png"],
    ["sin extensión", "comprobantes/u-ana/foto"],
    ["extensión gif", "comprobantes/u-ana/foto.gif"],
    ["extensión pdf", "comprobantes/u-ana/foto.pdf"],
    ["doble extensión", "comprobantes/u-ana/foto.png.exe"],
    ["otra raíz", "otros/u-ana/a.jpg"],
    ["raíz sin carpeta", "comprobantes"],
    ["prefijo parecido", "comprobantes/u-ana2/a.jpg"],
    ["sin /", "comprobantes/u-anaa.jpg"],
  ])("rechaza %s con 422", (_nombre, ruta) => {
    expect(errorDe(() => validar(ruta)).status).toBe(422);
  });

  it.each([[undefined], [null], [123], [""], [{}]])("rechaza una ruta que no es texto (%j)", (ruta) => {
    expect(errorDe(() => validar(ruta)).status).toBe(422);
  });

  it("rechaza un nombre demasiado largo", () => {
    expect(errorDe(() => validar(`comprobantes/u-ana/${"a".repeat(201)}.jpg`)).message).toMatch(/demasiado largo/);
  });
});
