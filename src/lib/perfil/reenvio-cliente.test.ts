import { describe, expect, it, vi } from "vitest";
import { ErrorImagen, MENSAJE_TAMANO, MENSAJE_TIPO } from "@/lib/imagenes/cliente";
import { MENSAJE_SIN_CONEXION } from "@/lib/reservas/asistente/api-cliente";
import { MENSAJE_FALLA_SUBIDA, reenviarDesdeElPerfil, type DependenciasDeReenvio, type EntradaDeReenvio } from "./reenvio-cliente";

const archivo = (nombre = "comprobante.jpg", tipo = "image/jpeg", tamano = 1000) => ({ name: nombre, type: tipo, size: tamano }) as unknown as File;
const entrada = (extra: Partial<EntradaDeReenvio> = {}): EntradaDeReenvio => ({ pagoId: "pago-1", metodo: "yape", archivo: archivo(), usuarioId: "u1", ...extra });
const json = (cuerpo: unknown, status: number) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
const errorApi = (codigo: string, mensaje: string, status: number) => json({ error: { codigo, mensaje } }, status);

function armar(respuesta: () => Promise<Response> | Response = () => json({}, 201)) {
  const subir = vi.fn(async () => "comprobantes/u1/a.jpg");
  const pedir = vi.fn(async (_url: string, _init?: RequestInit) => respuesta());
  const dependencias: DependenciasDeReenvio = { subir, pedir, candado: { enCurso: null } };
  return { subir, pedir, dependencias };
}

describe("reenviarDesdeElPerfil", () => {
  it("sube la imagen y llama a POST /api/pagos con pago_id, metodo y la ruta, sin monto", async () => {
    const { subir, pedir, dependencias } = armar();
    expect(await reenviarDesdeElPerfil(entrada(), dependencias)).toEqual({ tipo: "ok" });
    expect(subir).toHaveBeenCalledTimes(1);
    expect(pedir).toHaveBeenCalledTimes(1);
    const [url, init] = pedir.mock.calls[0];
    expect(url).toBe("/api/pagos");
    expect(init?.method).toBe("POST");
    const cuerpo = JSON.parse(String(init?.body));
    expect(cuerpo).toEqual({ pago_id: "pago-1", metodo: "yape", comprobante: "comprobantes/u1/a.jpg" });
    expect(cuerpo).not.toHaveProperty("monto");
  });

  it.each([
    ["un PDF", archivo("c.pdf", "application/pdf"), MENSAJE_TIPO],
    ["una imagen de 6 MB", archivo("c.jpg", "image/jpeg", 6 * 1024 * 1024), MENSAJE_TAMANO],
  ])("%s: muestra el mensaje del archivo y no sube ni llama a la API", async (_n, a, mensaje) => {
    const { subir, pedir, dependencias } = armar();
    expect(await reenviarDesdeElPerfil(entrada({ archivo: a }), dependencias)).toEqual({ tipo: "error", mensaje });
    expect(subir).not.toHaveBeenCalled();
    expect(pedir).not.toHaveBeenCalled();
  });

  it("falla la subida: 'No pudimos subir tu imagen...' y no se crea ningún pago", async () => {
    const { pedir, dependencias } = armar();
    dependencias.subir = async () => {
      throw new Error("red");
    };
    expect(await reenviarDesdeElPerfil(entrada(), dependencias)).toEqual({
      tipo: "error",
      mensaje: "No pudimos subir tu imagen. Revisa tu conexión e inténtalo de nuevo.",
    });
    expect(MENSAJE_FALLA_SUBIDA).toBe("No pudimos subir tu imagen. Revisa tu conexión e inténtalo de nuevo.");
    expect(pedir).not.toHaveBeenCalled();
  });

  it("el mensaje de subida de la biblioteca también se reemplaza por el del perfil", async () => {
    const { dependencias } = armar();
    dependencias.subir = async () => {
      throw new ErrorImagen("No pudimos subir la imagen. Revisa tu internet e inténtalo de nuevo.");
    };
    expect((await reenviarDesdeElPerfil(entrada(), dependencias))).toMatchObject({ mensaje: MENSAJE_FALLA_SUBIDA });
  });

  it("doble clic: el botón envía una sola vez y ambas llamadas reciben el mismo resultado", async () => {
    let liberar!: (r: Response) => void;
    const { subir, pedir, dependencias } = armar(() => new Promise<Response>((r) => (liberar = r)));
    const a = reenviarDesdeElPerfil(entrada(), dependencias);
    const b = reenviarDesdeElPerfil(entrada(), dependencias);
    await vi.waitFor(() => expect(pedir).toHaveBeenCalledTimes(1));
    liberar(json({}, 201));
    expect(await a).toEqual({ tipo: "ok" });
    expect(await b).toEqual({ tipo: "ok" });
    expect(subir).toHaveBeenCalledTimes(1);
    expect(pedir).toHaveBeenCalledTimes(1);
    // Terminado el envío, el candado se libera.
    expect(dependencias.candado.enCurso).toBeNull();
  });

  it("sin método o sin archivo no hace nada", async () => {
    const { subir, pedir, dependencias } = armar();
    expect(await reenviarDesdeElPerfil(entrada({ metodo: null }), dependencias)).toMatchObject({ tipo: "error" });
    expect(await reenviarDesdeElPerfil(entrada({ archivo: null }), dependencias)).toMatchObject({ tipo: "error" });
    expect(subir).not.toHaveBeenCalled();
    expect(pedir).not.toHaveBeenCalled();
  });

  it("sin conexión al llamar a la API", async () => {
    const { dependencias } = armar(() => {
      throw new Error("sin red");
    });
    expect(await reenviarDesdeElPerfil(entrada(), dependencias)).toEqual({ tipo: "error", mensaje: MENSAJE_SIN_CONEXION });
  });
});

describe("reenviarDesdeElPerfil: respuestas del servidor", () => {
  const MENSAJE_PLAZO = "Pasó el plazo para subir otro comprobante. Puedes empezar de nuevo con una reserva y un pago nuevos.";

  it("409 plazo_vencido", async () => {
    const { dependencias } = armar(() => errorApi("plazo_vencido", MENSAJE_PLAZO, 409));
    expect(await reenviarDesdeElPerfil(entrada(), dependencias)).toEqual({ tipo: "plazo_vencido", mensaje: MENSAJE_PLAZO });
  });

  it("409 por otro comprobante en revisión", async () => {
    const { dependencias } = armar(() => errorApi("conflicto", "Ya tienes un comprobante en revisión.", 409));
    expect(await reenviarDesdeElPerfil(entrada(), dependencias)).toEqual({ tipo: "en_espera", mensaje: "Ya tienes un comprobante en revisión." });
  });

  it("404", async () => {
    const { dependencias } = armar(() => errorApi("no_encontrado", "No encontramos ese pago.", 404));
    expect(await reenviarDesdeElPerfil(entrada(), dependencias)).toEqual({ tipo: "no_encontrado", mensaje: "No encontramos ese pago." });
  });

  it("422 y 503 muestran el mensaje del servidor", async () => {
    const a = armar(() => errorApi("datos_invalidos", "Elige cómo vas a pagar: Yape o transferencia.", 422));
    expect(await reenviarDesdeElPerfil(entrada(), a.dependencias)).toMatchObject({ tipo: "error", mensaje: "Elige cómo vas a pagar: Yape o transferencia." });
    const b = armar(() => errorApi("no_disponible", "Inténtalo en unos segundos.", 503));
    expect(await reenviarDesdeElPerfil(entrada(), b.dependencias)).toMatchObject({ tipo: "error", mensaje: "Inténtalo en unos segundos." });
  });
});
