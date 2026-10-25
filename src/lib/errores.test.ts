import { describe, expect, it, vi } from "vitest";
import { ErrorApi, manejar } from "./errores";

describe("manejar", () => {
  it.each([
    [ErrorApi.sinSesion(), 401],
    [ErrorApi.sinPermiso(), 403],
    [ErrorApi.noEncontrado(), 404],
    [ErrorApi.conflicto("Esa hora ya fue tomada."), 409],
    [ErrorApi.invalido("Dato inválido."), 422],
    [ErrorApi.noDisponible(), 503],
  ])("responde %j con el formato único", async (error, status) => {
    const res = await manejar(async () => {
      throw error;
    })();
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({
      error: { codigo: error.codigo, mensaje: error.message },
    });
  });

  it("devuelve una respuesta normal sin tocarla", async () => {
    const res = await manejar(async () => new Response("ok"))();
    expect(await res.text()).toBe("ok");
  });

  it("oculta el detalle de un error inesperado y lo registra", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = new Error('relation "usuarios" does not exist');
    const res = await manejar(async () => {
      throw original;
    })();
    const cuerpo = JSON.stringify(await res.json());
    expect(res.status).toBe(500);
    expect(cuerpo).not.toContain("usuarios");
    expect(log).toHaveBeenCalledWith(expect.any(String), original);
    log.mockRestore();
  });
});
