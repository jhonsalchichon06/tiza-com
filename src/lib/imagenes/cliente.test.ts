import { describe, expect, it, vi } from "vitest";
import {
  ErrorImagen,
  MENSAJE_OTRA_IMAGEN,
  MENSAJE_SUBIDA,
  MENSAJE_TAMANO,
  MENSAJE_TIPO,
  calcularDimensiones,
  prepararImagen,
  subirImagen,
  validarArchivoOriginal,
  type EntornoDeImagen,
  type Subidor,
} from "./cliente";

const MB = 1024 * 1024;
const archivo = (nombre: string, tipo: string, bytes: number) => new File([new Uint8Array(bytes)], nombre, { type: tipo });
const blob = (tipo: string, bytes: number) => new Blob([new Uint8Array(bytes)], { type: tipo });

const mensajeDe = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorImagen);
    return (e as Error).message;
  }
  throw new Error("no lanzó");
};

describe("validarArchivoOriginal", () => {
  it.each([
    ["un PDF", archivo("a.pdf", "application/pdf", 1000)],
    ["un GIF", archivo("a.gif", "image/gif", 1000)],
    ["un PNG con extensión .pdf", archivo("a.pdf", "image/png", 1000)],
    ["un PDF con extensión .png", archivo("a.png", "application/pdf", 1000)],
    ["un archivo sin tipo", archivo("a.png", "", 1000)],
  ])("rechaza %s e indica los tipos aceptados", (_nombre, f) => {
    expect(mensajeDe(() => validarArchivoOriginal(f))).toBe(MENSAJE_TIPO);
  });

  it("rechaza 5,1 MB e indica el máximo de 5 MB", () => {
    expect(mensajeDe(() => validarArchivoOriginal(archivo("a.jpg", "image/jpeg", 5.1 * MB)))).toBe(MENSAJE_TAMANO);
    expect(MENSAJE_TAMANO).toMatch(/5 MB/);
  });

  it("acepta 4,8 MB y justo 5 MB", () => {
    expect(() => validarArchivoOriginal(archivo("a.png", "image/png", 4.8 * MB))).not.toThrow();
    expect(() => validarArchivoOriginal(archivo("a.png", "image/png", 5 * MB))).not.toThrow();
  });

  it.each([["a.JPG", "image/jpeg"], ["a.jpeg", "image/jpeg"], ["a.webp", "image/webp"]])("acepta %s", (nombre, tipo) => {
    expect(() => validarArchivoOriginal(archivo(nombre, tipo, 1000))).not.toThrow();
  });
});

describe("calcularDimensiones", () => {
  it("4000 × 3000 sale a 2000 × 1500 conservando la proporción", () => {
    expect(calcularDimensiones(4000, 3000)).toEqual({ ancho: 2000, alto: 1500 });
    expect(calcularDimensiones(3000, 4000)).toEqual({ ancho: 1500, alto: 2000 });
  });

  it("no amplía: 800 × 600 se queda igual, y 2000 × 2000 también", () => {
    expect(calcularDimensiones(800, 600)).toEqual({ ancho: 800, alto: 600 });
    expect(calcularDimensiones(2000, 2000)).toEqual({ ancho: 2000, alto: 2000 });
  });

  it("nunca devuelve 0", () => {
    expect(calcularDimensiones(10000, 1)).toEqual({ ancho: 2000, alto: 1 });
  });
});

function entorno({
  ancho = 4000,
  alto = 3000,
  tamanos = {} as Record<string, number>,
  soloJpeg = false,
  falla = false,
}: { ancho?: number; alto?: number; tamanos?: Record<string, number>; soloJpeg?: boolean; falla?: boolean } = {}) {
  const llamadas: { ancho: number; alto: number; tipo: string; calidad: number }[] = [];
  const cerrar = vi.fn();
  const e: EntornoDeImagen = {
    decodificar: async () => {
      if (falla) throw new Error("no se pudo decodificar");
      return { ancho, alto, origen: {}, cerrar };
    },
    codificar: async (_img, a, h, tipo, calidad) => {
      llamadas.push({ ancho: a, alto: h, tipo, calidad });
      if (soloJpeg && tipo === "image/webp") return blob("image/png", 3 * MB); // el navegador no codifica WebP
      return blob(tipo, tamanos[`${tipo}@${calidad}`] ?? 0.5 * MB);
    },
  };
  return { e, llamadas, cerrar };
}

describe("prepararImagen", () => {
  it("reduce una foto de 4000 × 3000 a 2000 × 1500 y la deja en 1 MB o menos", async () => {
    const { e, llamadas, cerrar } = entorno({ tamanos: { "image/webp@0.85": 3 * MB, "image/webp@0.75": 2 * MB, "image/webp@0.65": 1.2 * MB, "image/webp@0.55": 0.9 * MB } });
    const resultado = await prepararImagen(archivo("foto.jpg", "image/jpeg", 4.8 * MB), e);
    expect(resultado.type).toBe("image/webp");
    expect(resultado.size).toBeLessThanOrEqual(1 * MB);
    expect(llamadas.every((l) => l.ancho === 2000 && l.alto === 1500)).toBe(true);
    expect(llamadas.map((l) => l.calidad)).toEqual([0.85, 0.75, 0.65, 0.55]); // baja la calidad hasta llegar a 1 MB
    expect(cerrar).toHaveBeenCalledTimes(1); // libera la imagen decodificada
  });

  it("no amplía una imagen pequeña de 800 × 600", async () => {
    const { e, llamadas } = entorno({ ancho: 800, alto: 600 });
    await prepararImagen(archivo("a.png", "image/png", 300_000), e);
    expect(llamadas[0]).toMatchObject({ ancho: 800, alto: 600 });
  });

  it("usa JPEG si el navegador no codifica WebP", async () => {
    const { e, llamadas } = entorno({ soloJpeg: true });
    const resultado = await prepararImagen(archivo("a.png", "image/png", 4 * MB), e);
    expect(resultado.type).toBe("image/jpeg");
    expect(llamadas.map((l) => l.tipo)).toEqual(["image/webp", "image/jpeg"]);
  });

  it("si no llega a 1 MB pero cabe en 4 MB, sube lo mejor que consiguió", async () => {
    const todos = Object.fromEntries([0.85, 0.75, 0.65, 0.55, 0.5].map((q) => [`image/webp@${q}`, 2 * MB]));
    const { e } = entorno({ tamanos: todos });
    expect((await prepararImagen(archivo("a.jpg", "image/jpeg", 4.8 * MB), e)).size).toBe(2 * MB);
  });

  it("si lo comprimido sigue pasando de 4 MB pide otra imagen", async () => {
    const todos = Object.fromEntries(["image/webp", "image/jpeg"].flatMap((t) => [0.85, 0.75, 0.65, 0.55, 0.5].map((q) => [`${t}@${q}`, 4.5 * MB])));
    const { e } = entorno({ tamanos: todos });
    await expect(prepararImagen(archivo("a.jpg", "image/jpeg", 4.8 * MB), e)).rejects.toThrow(MENSAJE_OTRA_IMAGEN);
  });

  it("si falla la compresión con un original de 3 MB, sube el original", async () => {
    const original = archivo("a.jpg", "image/jpeg", 3 * MB);
    expect(await prepararImagen(original, entorno({ falla: true }).e)).toBe(original);
  });

  it("si falla la compresión con un original de 4,8 MB, pide otra imagen y no sube nada", async () => {
    await expect(prepararImagen(archivo("a.jpg", "image/jpeg", 4.8 * MB), entorno({ falla: true }).e)).rejects.toMatchObject({
      message: MENSAJE_OTRA_IMAGEN,
    });
  });
});

describe("subirImagen", () => {
  const sinProcesar: EntornoDeImagen = entorno({ tamanos: { "image/webp@0.85": 0.4 * MB } }).e;
  const comprobante = { tipo: "comprobante", usuarioId: "u-ana" } as const;

  it("sube a la carpeta del usuario y devuelve la ruta final de Blob", async () => {
    const subir = vi.fn<Subidor>(async (ruta) => ({ pathname: ruta.replace(".webp", "-AbC123.webp") }));
    const ruta = await subirImagen(archivo("yape.png", "image/png", 2 * MB), { destino: comprobante }, { entorno: sinProcesar, subir });
    expect(ruta).toMatch(/^comprobantes\/u-ana\/\d+-AbC123\.webp$/);
    expect(subir.mock.calls[0][0]).toMatch(/^comprobantes\/u-ana\/\d+\.webp$/);
    expect(subir.mock.calls[0][2].clientPayload).toBe(JSON.stringify({ tipo: "comprobante" }));
  });

  it("las fotos van a la carpeta de la reserva", async () => {
    const subir = vi.fn(async (ruta: string) => ({ pathname: ruta }));
    const ruta = await subirImagen(archivo("a.jpg", "image/jpeg", 1 * MB), { destino: { tipo: "foto", reservaId: "res_9" } }, { entorno: sinProcesar, subir });
    expect(ruta).toMatch(/^fotos\/res_9\/\d+\.webp$/);
  });

  it.each([
    ["un PDF", archivo("a.pdf", "application/pdf", 1000)],
    ["5,1 MB", archivo("a.jpg", "image/jpeg", 5.1 * MB)],
  ])("con %s no pide token ni sube nada", async (_n, f) => {
    const subir = vi.fn();
    await expect(subirImagen(f, { destino: comprobante }, { entorno: sinProcesar, subir })).rejects.toBeInstanceOf(ErrorImagen);
    expect(subir).not.toHaveBeenCalled();
  });

  it("si la subida falla devuelve un mensaje para reintentar y no entrega ninguna ruta", async () => {
    const subir = vi.fn(async () => {
      throw new Error("red caída");
    });
    const resultado = await subirImagen(archivo("a.jpg", "image/jpeg", 1 * MB), { destino: comprobante }, { entorno: sinProcesar, subir }).then(
      () => "ruta",
      (e: Error) => e.message,
    );
    expect(resultado).toBe(MENSAJE_SUBIDA);
  });

  it("informa el progreso", async () => {
    const onProgreso = vi.fn();
    const subir = vi.fn(async (ruta: string, _c: Blob, o: { onProgreso?: (p: number) => void }) => {
      o.onProgreso?.(50);
      return { pathname: ruta };
    });
    await subirImagen(archivo("a.jpg", "image/jpeg", 1 * MB), { destino: comprobante, onProgreso }, { entorno: sinProcesar, subir });
    expect(onProgreso).toHaveBeenCalledWith(50);
  });
});
