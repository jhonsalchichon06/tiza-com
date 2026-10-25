import { describe, expect, it, vi } from "vitest";

// Sin simular el cliente: así se ejercita la validación real de variables de entorno.
describe("GET /api/salud sin DATABASE_URL", () => {
  it("responde 500 genérico y registra en el log la variable que falta", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");

    const res = await GET();
    const cuerpo = await res.text();

    expect(res.status).toBe(500);
    expect(JSON.parse(cuerpo).error.codigo).toBe("error_interno");
    expect(cuerpo).not.toContain("DATABASE_URL");
    expect(log).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ message: expect.stringContaining("DATABASE_URL") }),
    );
    vi.unstubAllEnvs();
    // La primera importación de la ruta carga el cliente de Neon; con muchos archivos en paralelo supera los 5 s por defecto.
  }, 30_000);
});
