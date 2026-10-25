import { beforeEach, describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "./__fixtures__/configuracion";

const consultar = vi.fn();
vi.mock("@/db/cliente", () => ({
  db: () => ({ select: () => ({ from: () => consultar() }) }),
}));

import { leerCatalogo } from "./leer-catalogo";

const filas = (valores: Record<string, unknown>) => Object.entries(valores).map(([clave, valor]) => ({ clave, valor }));

describe("leerCatalogo", () => {
  beforeEach(() => {
    consultar.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("reintenta una vez si hay error de conexión", async () => {
    consultar.mockRejectedValueOnce(Object.assign(new Error("fetch failed"), { code: "ECONNRESET" }));
    consultar.mockResolvedValueOnce(filas(VALORES_DEL_DISENO));
    const c = await leerCatalogo();
    expect(consultar).toHaveBeenCalledTimes(2);
    expect(c.servicios[0].desde).toBe("S/ 66");
  });

  it("falla nombrando la clave si falta un parámetro", async () => {
    const { horas_gratis: _, ...sin } = VALORES_DEL_DISENO;
    consultar.mockResolvedValue(filas(sin));
    await expect(leerCatalogo()).rejects.toThrow(/horas_gratis/);
  });
});
