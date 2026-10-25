import { describe, expect, it, vi } from "vitest";
import { ErrorApi } from "./errores";
import { conReintento } from "./reintento";

const caidaDeRed = () => Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" });
const violacionUnica = () => Object.assign(new Error("duplicate key"), { code: "23505" });

describe("conReintento", () => {
  it("reintenta una vez y entrega el resultado si Neon despierta", async () => {
    const operacion = vi.fn().mockRejectedValueOnce(caidaDeRed()).mockResolvedValueOnce("ok");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(conReintento(operacion, 0)).resolves.toBe("ok");
    expect(operacion).toHaveBeenCalledTimes(2);
  });

  it("responde 503 'Inténtalo en unos segundos' si el reintento también falla", async () => {
    const operacion = vi.fn().mockRejectedValue(caidaDeRed());
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = (await conReintento(operacion, 0).catch((e: unknown) => e)) as ErrorApi;
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error.status).toBe(503);
    expect(error.message).toMatch(/unos segundos/i);
    expect(operacion).toHaveBeenCalledTimes(2);
  });

  it("no reintenta errores de datos", async () => {
    const operacion = vi.fn().mockRejectedValue(violacionUnica());
    await expect(conReintento(operacion, 0)).rejects.toMatchObject({ code: "23505" });
    expect(operacion).toHaveBeenCalledTimes(1);
  });

  it("no reintenta errores sin forma de conexión", async () => {
    const operacion = vi.fn().mockRejectedValue(new TypeError("x is undefined"));
    await expect(conReintento(operacion, 0)).rejects.toBeInstanceOf(TypeError);
    expect(operacion).toHaveBeenCalledTimes(1);
  });

  it("reconoce errores de conexión de Neon por mensaje", async () => {
    const operacion = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection terminated unexpectedly"))
      .mockResolvedValueOnce(1);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(conReintento(operacion, 0)).resolves.toBe(1);
  });
});
