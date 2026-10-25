import { describe, expect, it, vi } from "vitest";
import { MENSAJE_SUBIDA, MENSAJE_TAMANO, MENSAJE_TIPO, ErrorImagen } from "@/lib/imagenes/cliente";
import { MENSAJE_SIN_CONEXION } from "./api-cliente";
import { subirComprobante } from "./comprobante";

const archivo = (name: string, type: string, size: number) => ({ name, type, size }) as File;
const MB = 1024 * 1024;

describe("subirComprobante", () => {
  it("sube una imagen válida y devuelve la ruta", async () => {
    const subir = vi.fn(async () => "comprobantes/u1/1.webp");
    const r = await subirComprobante(archivo("c.jpg", "image/jpeg", 4.8 * MB), "u1", subir);
    expect(r).toEqual({ ok: true, ruta: "comprobantes/u1/1.webp" });
    expect(subir).toHaveBeenCalledWith(expect.anything(), { destino: { tipo: "comprobante", usuarioId: "u1" } });
  });

  it("rechaza un PDF sin subir nada", async () => {
    const subir = vi.fn(async () => "x");
    expect(await subirComprobante(archivo("c.pdf", "application/pdf", 1000), "u1", subir)).toEqual({ ok: false, mensaje: MENSAJE_TIPO });
    expect(subir).not.toHaveBeenCalled();
  });

  it("rechaza una imagen de más de 5 MB sin subir nada", async () => {
    const subir = vi.fn(async () => "x");
    expect(await subirComprobante(archivo("c.png", "image/png", 5 * MB + 1), "u1", subir)).toEqual({ ok: false, mensaje: MENSAJE_TAMANO });
    expect(subir).not.toHaveBeenCalled();
  });

  it("muestra el error de la subida", async () => {
    const subir = async () => {
      throw new ErrorImagen(MENSAJE_SUBIDA);
    };
    expect(await subirComprobante(archivo("c.jpg", "image/jpeg", 1000), "u1", subir)).toEqual({ ok: false, mensaje: MENSAJE_SUBIDA });
  });

  it("un error inesperado da un mensaje claro", async () => {
    const subir = async () => {
      throw new TypeError("boom");
    };
    expect(await subirComprobante(archivo("c.jpg", "image/jpeg", 1000), "u1", subir)).toEqual({ ok: false, mensaje: MENSAJE_SIN_CONEXION });
  });
});
