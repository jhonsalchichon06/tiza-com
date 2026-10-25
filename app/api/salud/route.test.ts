import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("@/db/cliente", () => ({ db: () => ({ execute }) }));

const { GET } = await import("./route");

const CADENA = "postgres://usuario:secreto@ep-tiza-123.us-east-1.aws.neon.tech/neondb";
const caidaDeConexion = () =>
  Object.assign(new Error(`connect ETIMEDOUT ep-tiza-123.us-east-1.aws.neon.tech (${CADENA})`), {
    code: "ETIMEDOUT",
  });

describe("GET /api/salud", () => {
  beforeEach(() => {
    execute.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("responde 200 con estado ok si la base contesta", async () => {
    execute.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ estado: "ok" });
  });

  it("responde 200 si la base contesta al reintento", async () => {
    execute.mockRejectedValueOnce(caidaDeConexion()).mockResolvedValueOnce({ rows: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ estado: "ok" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("responde 503 'Inténtalo en unos segundos' sin la cadena de conexión ni el host si falla dos veces", async () => {
    execute.mockRejectedValue(caidaDeConexion());
    const res = await GET();
    const cuerpo = await res.text();
    expect(res.status).toBe(503);
    expect(JSON.parse(cuerpo)).toEqual({
      error: { codigo: "no_disponible", mensaje: "Inténtalo en unos segundos." },
    });
    expect(cuerpo).not.toContain("neon.tech");
    expect(cuerpo).not.toContain("secreto");
  });
});
