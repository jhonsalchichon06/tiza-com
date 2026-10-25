import { describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../errores";
import type { AlmacenDeImagenes } from "./almacen";
import { verificarImagenSubida } from "./verificar";

const MB = 1024 * 1024;
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const WEBP = new Uint8Array([...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8 ")]);
const PDF = new Uint8Array(ascii("%PDF-1.7\n%âãÏÓ"));
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0, 0x04, 0, 0, 0]);

const usuario = { id: "u-ana", rol: "cliente" as const };

function almacen(archivos: Record<string, { tamano: number; inicio: Uint8Array }>) {
  const metadatos = vi.fn(async (ruta: string) => (archivos[ruta] ? { tamano: archivos[ruta].tamano, tipoDeclarado: "image/webp" } : null));
  const leerInicio = vi.fn(async (ruta: string) => archivos[ruta]?.inicio ?? null);
  return { almacen: { metadatos, leerInicio } as Pick<AlmacenDeImagenes, "metadatos" | "leerInicio">, metadatos, leerInicio };
}

const errorDe = (promesa: Promise<unknown>) => promesa.then(() => null, (e: ErrorApi) => e);

describe("verificarImagenSubida", () => {
  it("acepta un WebP de 800 KB en la carpeta del usuario y devuelve ruta, tipo y tamaño", async () => {
    const { almacen: a } = almacen({ "comprobantes/u-ana/abc.webp": { tamano: 800 * 1024, inicio: WEBP } });
    expect(await verificarImagenSubida({ ruta: "comprobantes/u-ana/abc.webp", usuario }, a)).toEqual({
      ruta: "comprobantes/u-ana/abc.webp",
      tipo: "image/webp",
      tamano: 800 * 1024,
    });
  });

  it("un archivo inexistente da 404 y no lee nada más", async () => {
    const { almacen: a, leerInicio } = almacen({});
    const error = await errorDe(verificarImagenSubida({ ruta: "comprobantes/u-ana/no-existe.webp", usuario }, a));
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error?.status).toBe(404);
    expect(leerInicio).not.toHaveBeenCalled();
  });

  it("un archivo en la carpeta de otro usuario da 422 sin consultar Blob", async () => {
    const { almacen: a, metadatos } = almacen({ "comprobantes/u-otro/a.webp": { tamano: 1000, inicio: WEBP } });
    const error = await errorDe(verificarImagenSubida({ ruta: "comprobantes/u-otro/a.webp", usuario }, a));
    expect(error?.status).toBe(422);
    expect(metadatos).not.toHaveBeenCalled();
  });

  it.each([
    ["un PDF", PDF],
    ["un ejecutable", EXE],
  ])("%s con extensión .png da 422", async (_n, inicio) => {
    const { almacen: a } = almacen({ "comprobantes/u-ana/falso.png": { tamano: 5000, inicio } });
    const error = await errorDe(verificarImagenSubida({ ruta: "comprobantes/u-ana/falso.png", usuario }, a));
    expect(error?.status).toBe(422);
    expect(error?.message).toMatch(/JPG, PNG o WebP/);
  });

  it("un archivo de 4,3 MB da 422 sin leer su contenido", async () => {
    const { almacen: a, leerInicio } = almacen({ "comprobantes/u-ana/grande.webp": { tamano: 4.3 * MB, inicio: WEBP } });
    const error = await errorDe(verificarImagenSubida({ ruta: "comprobantes/u-ana/grande.webp", usuario }, a));
    expect(error?.status).toBe(422);
    expect(error?.message).toMatch(/4 MB/);
    expect(leerInicio).not.toHaveBeenCalled();
  });

  it("acepta justo 4 MB", async () => {
    const { almacen: a } = almacen({ "comprobantes/u-ana/justo.webp": { tamano: 4 * MB, inicio: WEBP } });
    await expect(verificarImagenSubida({ ruta: "comprobantes/u-ana/justo.webp", usuario }, a)).resolves.toMatchObject({ tamano: 4 * MB });
  });

  it("el archivo que desaparece entre la consulta y la lectura da 404", async () => {
    const metadatos = vi.fn(async () => ({ tamano: 1000, tipoDeclarado: "image/webp" }));
    const leerInicio = vi.fn(async () => null);
    const error = await errorDe(verificarImagenSubida({ ruta: "comprobantes/u-ana/a.webp", usuario }, { metadatos, leerInicio }));
    expect(error?.status).toBe(404);
  });

  it("una ruta inválida da 422 y un cliente que pide fotos 403", async () => {
    const { almacen: a } = almacen({});
    expect((await errorDe(verificarImagenSubida({ ruta: "comprobantes/u-ana/../x.png", usuario }, a)))?.status).toBe(422);
    expect((await errorDe(verificarImagenSubida({ ruta: "fotos/r1/a.png", usuario }, a)))?.status).toBe(403);
  });

  it("la función solo lee: no hay forma de que cree filas (no recibe base de datos)", async () => {
    expect(verificarImagenSubida.length).toBeLessThanOrEqual(2);
  });
});
