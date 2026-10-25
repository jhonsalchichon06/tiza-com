import { describe, expect, it, vi } from "vitest";
import { crearRutaCronHuerfanos } from "./cron";

vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const SECRETO = "s".repeat(40);
const llamar = (handler: ReturnType<typeof crearRutaCronHuerfanos>, cabeceras: Record<string, string> = {}) =>
  handler(new Request("http://localhost:3000/api/cron/huerfanos", { headers: cabeceras }));

function ruta(extra: Parameters<typeof crearRutaCronHuerfanos>[0] = {}) {
  const limpiar = vi.fn(async () => ({ omitido: false, revisados: 5, borrados: 2, fallidos: 0 }));
  return { handler: crearRutaCronHuerfanos({ leerSecreto: () => SECRETO, limpiar, ...extra }), limpiar };
}

describe("GET /api/cron/huerfanos", () => {
  it("con el secreto correcto ejecuta la limpieza y responde 200 con las cantidades", async () => {
    const { handler, limpiar } = ruta();
    const res = await llamar(handler, { authorization: `Bearer ${SECRETO}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ omitido: false, revisados: 5, borrados: 2, fallidos: 0 });
    expect(limpiar).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["sin cabecera", {}],
    ["con otro secreto", { authorization: `Bearer ${"x".repeat(40)}` }],
    ["sin la palabra Bearer", { authorization: SECRETO }],
    ["con un secreto más corto", { authorization: "Bearer corto" }],
    ["con la cookie de un administrador", { cookie: "better-auth.session_token=admin" }],
  ])("responde 401 %s y no borra nada", async (_nombre, cabeceras) => {
    const { handler, limpiar } = ruta();
    const res = await llamar(handler, cabeceras);
    expect(res.status).toBe(401);
    expect(limpiar).not.toHaveBeenCalled();
  });

  it("responde 503 si falta CRON_SECRET, lo registra y no borra nada", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler, limpiar } = ruta({
      leerSecreto: () => {
        throw new Error("Falta configurar la variable de entorno: CRON_SECRET");
      },
    });
    const res = await llamar(handler, { authorization: "Bearer lo-que-sea" });
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("CRON_SECRET");
    expect(log).toHaveBeenCalled();
    expect(limpiar).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("si la limpieza falla responde un error genérico", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler } = ruta({ limpiar: async () => { throw new Error("tabla pagos no existe"); } });
    const res = await llamar(handler, { authorization: `Bearer ${SECRETO}` });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("tabla pagos");
    log.mockRestore();
  });

  it("indica cuando la limpieza se omitió por registro vacío", async () => {
    const { handler } = ruta({ limpiar: async () => ({ omitido: true, revisados: 0, borrados: 0, fallidos: 0 }) });
    const res = await llamar(handler, { authorization: `Bearer ${SECRETO}` });
    expect((await res.json()).omitido).toBe(true);
  });

  it("la ruta real, sin dependencias, trabaja con el registro: la columna del comprobante de pago y la de las fotos del servicio (#17)", async () => {
    const { COLUMNAS_CON_IMAGEN } = await import("./referencias");
    const { pagos, fotosServicio } = await import("@/db/esquema");
    expect(COLUMNAS_CON_IMAGEN[0].tabla).toBe(pagos);
    expect(COLUMNAS_CON_IMAGEN[0].columna).toBe(pagos.comprobanteRuta);
    expect(COLUMNAS_CON_IMAGEN).toContainEqual({ tabla: fotosServicio, columna: fotosServicio.ruta });
  });
});
