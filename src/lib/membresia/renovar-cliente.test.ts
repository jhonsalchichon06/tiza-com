import { describe, expect, it, vi } from "vitest";
import { MENSAJE_TAMANO, MENSAJE_TIPO } from "@/lib/imagenes/cliente";
import { MENSAJE_SIN_CONEXION } from "@/lib/reservas/asistente/api-cliente";
import { MENSAJE_FALLA_SUBIDA, renovarDesdeElPerfil, type DependenciasDeRenovacion, type EntradaDeRenovacion } from "./renovar-cliente";

const archivo = (nombre = "comprobante.jpg", tipo = "image/jpeg", tamano = 1000) => ({ name: nombre, type: tipo, size: tamano }) as unknown as File;
const entrada = (extra: Partial<EntradaDeRenovacion> = {}): EntradaDeRenovacion => ({ metodo: "yape", archivo: archivo(), usuarioId: "u1", ...extra });
const json = (cuerpo: unknown, status: number) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

function armar(respuesta: () => Promise<Response> | Response = () => json({}, 201)) {
  const subir = vi.fn(async () => "comprobantes/u1/a.jpg");
  const pedir = vi.fn(async (_url: string, _init?: RequestInit) => respuesta());
  const dependencias: DependenciasDeRenovacion = { subir, pedir, candado: { enCurso: null } };
  return { subir, pedir, dependencias };
}

describe("renovarDesdeElPerfil", () => {
  it("sube la imagen y llama a POST /api/membresia/renovar con el método y la ruta, sin monto", async () => {
    const { subir, pedir, dependencias } = armar();
    expect(await renovarDesdeElPerfil(entrada(), dependencias)).toEqual({ tipo: "ok" });
    expect(subir).toHaveBeenCalledTimes(1);
    const [url, init] = pedir.mock.calls[0];
    expect(url).toBe("/api/membresia/renovar");
    expect(init?.method).toBe("POST");
    const cuerpo = JSON.parse(String(init?.body));
    expect(cuerpo).toEqual({ metodo: "yape", comprobante: "comprobantes/u1/a.jpg" });
    expect(cuerpo).not.toHaveProperty("monto");
  });

  it.each([
    ["un PDF", archivo("c.pdf", "application/pdf"), MENSAJE_TIPO],
    ["una imagen de 6 MB", archivo("c.jpg", "image/jpeg", 6 * 1024 * 1024), MENSAJE_TAMANO],
  ])("%s: muestra el mensaje del archivo y no sube ni llama a la API", async (_n, a, mensaje) => {
    const { subir, pedir, dependencias } = armar();
    expect(await renovarDesdeElPerfil(entrada({ archivo: a }), dependencias)).toEqual({ tipo: "error", mensaje });
    expect(subir).not.toHaveBeenCalled();
    expect(pedir).not.toHaveBeenCalled();
  });

  it("sin método o sin archivo: error y no llama a nada", async () => {
    const { subir, pedir, dependencias } = armar();
    expect(await renovarDesdeElPerfil(entrada({ metodo: null }), dependencias)).toMatchObject({ tipo: "error" });
    expect(await renovarDesdeElPerfil(entrada({ archivo: null }), dependencias)).toMatchObject({ tipo: "error" });
    expect(subir).not.toHaveBeenCalled();
    expect(pedir).not.toHaveBeenCalled();
  });

  it("falla la subida: mensaje de conexión y no se crea ningún pago", async () => {
    const { pedir, dependencias } = armar();
    dependencias.subir = async () => {
      throw new Error("red");
    };
    expect(await renovarDesdeElPerfil(entrada(), dependencias)).toMatchObject({ mensaje: MENSAJE_FALLA_SUBIDA });
    expect(pedir).not.toHaveBeenCalled();
  });

  it("sin conexión al llamar a la API: mensaje de conexión", async () => {
    const { dependencias } = armar(() => {
      throw new Error("red");
    });
    expect(await renovarDesdeElPerfil(entrada(), dependencias)).toEqual({ tipo: "error", mensaje: MENSAJE_SIN_CONEXION });
  });

  it("un 409 muestra el mensaje del servidor como no_aplica", async () => {
    const { dependencias } = armar(() => json({ error: { codigo: "renovacion_no_aplica", mensaje: "Tu membresía sigue vigente." } }, 409));
    expect(await renovarDesdeElPerfil(entrada(), dependencias)).toEqual({ tipo: "no_aplica", mensaje: "Tu membresía sigue vigente." });
  });

  it("un 422 del servidor es error con su mensaje", async () => {
    const { dependencias } = armar(() => json({ error: { codigo: "datos_invalidos", mensaje: "No encontramos ese comprobante." } }, 422));
    expect(await renovarDesdeElPerfil(entrada(), dependencias)).toEqual({ tipo: "error", mensaje: "No encontramos ese comprobante." });
  });

  it("el candado evita el doble clic: dos llamadas comparten un solo envío", async () => {
    const { pedir, dependencias } = armar();
    const a = renovarDesdeElPerfil(entrada(), dependencias);
    const b = renovarDesdeElPerfil(entrada(), dependencias);
    await Promise.all([a, b]);
    expect(pedir).toHaveBeenCalledTimes(1);
  });
});
