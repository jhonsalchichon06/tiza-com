import { describe, expect, it, vi } from "vitest";
import { ErrorDeApi, MENSAJE_SIN_CONEXION, pedirCotizacion, pedirDisponibilidad } from "./api-cliente";
import { PROFUNDA_2_1 } from "./__dobles__/cotizaciones";

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

describe("pedirCotizacion", () => {
  it("arma la URL de un servicio por tamaño", async () => {
    const pedir = vi.fn(async (_url: string, _init?: RequestInit) => json(PROFUNDA_2_1()));
    const cotizacion = await pedirCotizacion({ tipo: "profunda", dormitorios: 2, banos: 1 }, pedir);
    expect(pedir.mock.calls[0][0]).toBe("/api/cotizacion?tipo=profunda&dormitorios=2&banos=1");
    expect(cotizacion.total_a_pagar).toBe(33666); // tal cual lo devuelve el servidor
  });

  it("arma la URL de un paquete con horas", async () => {
    const pedir = vi.fn(async (_url: string, _init?: RequestInit) => json({}));
    await pedirCotizacion({ tipo: "paquete", horas: 6 }, pedir);
    expect(pedir.mock.calls[0][0]).toBe("/api/cotizacion?tipo=paquete&horas=6");
  });

  it("con la dirección agrega distrito, calle, número y departamento, y nunca las referencias", async () => {
    const pedir = vi.fn(async (_url: string, _init?: RequestInit) => json({}));
    await pedirCotizacion({ tipo: "profunda", dormitorios: 2, banos: 1 }, pedir, { distrito: "Miraflores", calle: " Av. Larco ", numero: "123", departamento: "Dpto 302" });
    const url = new URL(pedir.mock.calls[0][0], "http://x");
    expect(Object.fromEntries(url.searchParams)).toEqual({ tipo: "profunda", dormitorios: "2", banos: "1", distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: "Dpto 302" });
  });

  it("con la dirección sin departamento no envía ese parámetro", async () => {
    const pedir = vi.fn(async (_url: string, _init?: RequestInit) => json({}));
    await pedirCotizacion({ tipo: "paquete", horas: 3 }, pedir, { distrito: "Barranco", calle: "Jr. Junín", numero: "45", departamento: "  " });
    expect(pedir.mock.calls[0][0]).not.toContain("departamento");
  });

  it("envía 0 dormitorios como 0", async () => {
    const pedir = vi.fn(async (_url: string, _init?: RequestInit) => json({}));
    await pedirCotizacion({ tipo: "estandar", dormitorios: 0, banos: 1 }, pedir);
    expect(pedir.mock.calls[0][0]).toContain("dormitorios=0");
  });

  it("devuelve el mensaje del servidor en un error", async () => {
    const pedir = async () => json({ error: { codigo: "datos_invalidos", mensaje: "El hogar debe tener al menos 1 baño." } }, 422);
    await expect(pedirCotizacion({ tipo: "estandar", dormitorios: 1, banos: 0 }, pedir)).rejects.toMatchObject({
      message: "El hogar debe tener al menos 1 baño.",
      status: 422,
      codigo: "datos_invalidos",
    });
  });

  it("un fallo de red da un mensaje claro", async () => {
    const pedir = async () => {
      throw new TypeError("fetch failed");
    };
    const error = await pedirCotizacion({ tipo: "paquete", horas: 3 }, pedir).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDeApi);
    expect(error.message).toBe(MENSAJE_SIN_CONEXION);
  });

  it("no calcula ningún precio: devuelve el objeto del servidor sin tocarlo", async () => {
    const delServidor = { ...PROFUNDA_2_1(), total_a_pagar: 1 };
    const cotizacion = await pedirCotizacion({ tipo: "profunda", dormitorios: 2, banos: 1 }, async () => json(delServidor));
    expect(cotizacion.total_a_pagar).toBe(1);
  });
});

describe("pedirDisponibilidad", () => {
  it("agrega la fecha a los parámetros del servicio", async () => {
    const pedir = vi.fn(async (_url: string, _init?: RequestInit) => json({ fecha: "2026-11-09", atendido: true, horarios: [] }));
    await pedirDisponibilidad({ tipo: "profunda", dormitorios: 2, banos: 1 }, "2026-11-09", pedir);
    expect(pedir.mock.calls[0][0]).toBe("/api/disponibilidad?tipo=profunda&dormitorios=2&banos=1&fecha=2026-11-09");
  });

  it("devuelve el mensaje del servidor en un error", async () => {
    const pedir = async () => json({ error: { codigo: "datos_invalidos", mensaje: "Escribe una fecha válida con el formato AAAA-MM-DD." } }, 422);
    await expect(pedirDisponibilidad({ tipo: "paquete", horas: 3 }, "x", pedir)).rejects.toThrow("Escribe una fecha válida");
  });
});
