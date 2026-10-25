import { describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "./__fixtures__/configuracion";
import { leerConfiguracion } from "./configuracion";

vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const filas = (valores: Record<string, unknown>) => async () =>
  Object.entries(valores).map(([clave, valor]) => ({ clave, valor }));

describe("leerConfiguracion", () => {
  it("devuelve todos los parámetros tipados", async () => {
    const config = await leerConfiguracion(filas(VALORES_DEL_DISENO));
    expect(config).toEqual(VALORES_DEL_DISENO);
    expect(config.paquetes_horas[0].precio).toBe(9900);
  });

  it("hace una sola consulta", async () => {
    const consulta = vi.fn(filas(VALORES_DEL_DISENO));
    await leerConfiguracion(consulta);
    expect(consulta).toHaveBeenCalledTimes(1);
  });

  it("falla nombrando el parámetro que falta, sin usar un valor por defecto", async () => {
    const { espera_pago_horas: _, ...sinEspera } = VALORES_DEL_DISENO;
    await expect(leerConfiguracion(filas(sinEspera))).rejects.toThrow(/espera_pago_horas/);
  });

  it("falla nombrando el parámetro con un valor inválido", async () => {
    await expect(
      leerConfiguracion(filas({ ...VALORES_DEL_DISENO, traslado_horas: "una hora" })),
    ).rejects.toThrow(/traslado_horas/);
  });

  it("falla si hay más o menos precios que niveles", async () => {
    await expect(
      leerConfiguracion(filas({ ...VALORES_DEL_DISENO, precios_niveles: [6600, 9900, 12900] })),
    ).rejects.toThrow(/precios_niveles/);
  });

  it("devuelve un valor cambiado en la siguiente lectura (sin caché)", async () => {
    const valores: Record<string, unknown> = { ...VALORES_DEL_DISENO };
    const consulta = filas(valores); // lee `valores` en cada llamada, como la tabla
    expect((await leerConfiguracion(consulta)).anticipacion_minima_horas).toBe(48);
    valores.anticipacion_minima_horas = 72;
    expect((await leerConfiguracion(consulta)).anticipacion_minima_horas).toBe(72);
  });

  it("ignora filas de claves que todavía no conoce", async () => {
    await expect(leerConfiguracion(filas({ ...VALORES_DEL_DISENO, clave_futura: 1 }))).resolves.toEqual(
      VALORES_DEL_DISENO,
    );
  });
});
