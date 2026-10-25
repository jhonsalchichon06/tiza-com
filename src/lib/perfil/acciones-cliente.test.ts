import { describe, expect, it, vi } from "vitest";
import { MENSAJE_SIN_CONEXION } from "@/lib/reservas/asistente/api-cliente";
import { cancelarDesdeElPerfil, pedirHorariosDeReserva, reprogramarDesdeElPerfil } from "./acciones-cliente";

const ID = "11111111-1111-4111-8111-111111111111";
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
const error = (status: number, codigo: string, mensaje: string, extra: Record<string, unknown> = {}) => json({ error: { codigo, mensaje, ...extra } }, status);

describe("cancelarDesdeElPerfil", () => {
  const cuerpoOk = (extra: Record<string, unknown> = {}) => ({ reserva: { id: ID }, limpieza_gratis_conservada: false, horas_pagadas: 4, pago: { estado: "aprobado" }, credito: { generado_horas: 4, vence_en: "2027-02-05T10:00:00-05:00", devuelto_horas: 0 }, ...extra });

  it("llama a POST /api/reservas/:id/cancelar con JSON y devuelve el mensaje del crédito", async () => {
    const pedir = vi.fn(async (_u: string, _i?: RequestInit) => json(cuerpoOk()));
    const r = await cancelarDesdeElPerfil(ID, { pedir, candado: { enCurso: null } });
    expect(pedir).toHaveBeenCalledWith(`/api/reservas/${ID}/cancelar`, expect.objectContaining({ method: "POST" }));
    expect(pedir.mock.calls[0][1]?.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(r).toEqual({ tipo: "ok", limpiezaGratisConservada: false, mensajeCredito: "Te devolvimos 4 horas como crédito. Puedes usarlas hasta el 5 de febrero de 2027." });
  });

  it("limpieza gratis conservada y primera de 3 h (0 horas pagadas: sin mensaje de crédito)", async () => {
    const pedir = vi.fn(async () => json(cuerpoOk({ limpieza_gratis_conservada: true, horas_pagadas: 0, credito: { generado_horas: 0, vence_en: null, devuelto_horas: 0 } })));
    expect(await cancelarDesdeElPerfil(ID, { pedir, candado: { enCurso: null } })).toEqual({ tipo: "ok", limpiezaGratisConservada: true, mensajeCredito: null });
  });

  it("pago pendiente: 'Si se aprueba tu pago...'", async () => {
    const pedir = vi.fn(async () => json(cuerpoOk({ pago: { estado: "pendiente" }, credito: { generado_horas: 0, vence_en: null, devuelto_horas: 0 } })));
    expect(await cancelarDesdeElPerfil(ID, { pedir, candado: { enCurso: null } })).toMatchObject({ mensajeCredito: "Si se aprueba tu pago, las horas quedarán como crédito." });
  });

  it("si el crédito usado vuelve a su lote, lo dice junto al generado", async () => {
    const pedir = vi.fn(async () => json(cuerpoOk({ credito: { generado_horas: 2.5, vence_en: "2027-02-05T10:00:00-05:00", devuelto_horas: 1.5 } })));
    const r = await cancelarDesdeElPerfil(ID, { pedir, candado: { enCurso: null } });
    expect(r).toMatchObject({ tipo: "ok", mensajeCredito: expect.stringContaining("1,5 horas de crédito que usabas volvieron") });
  });

  it("doble clic: una sola llamada", async () => {
    let liberar!: (r: Response) => void;
    const pedir = vi.fn(() => new Promise<Response>((r) => (liberar = r)));
    const candado = { enCurso: null };
    const a = cancelarDesdeElPerfil(ID, { pedir, candado });
    const b = cancelarDesdeElPerfil(ID, { pedir, candado });
    liberar(json(cuerpoOk()));
    expect(await a).toEqual(await b);
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(candado.enCurso).toBeNull();
  });

  it("409 fuera_de_plazo con el enlace de WhatsApp", async () => {
    const pedir = async () => error(409, "fuera_de_plazo", "Solo puedes cancelar hasta 24 horas antes del servicio. Si necesitas ayuda, escríbenos por WhatsApp.", { whatsapp: "https://wa.me/519?text=Hola" });
    expect(await cancelarDesdeElPerfil(ID, { pedir, candado: { enCurso: null } })).toEqual({
      tipo: "fuera_de_plazo",
      mensaje: "Solo puedes cancelar hasta 24 horas antes del servicio. Si necesitas ayuda, escríbenos por WhatsApp.",
      whatsapp: "https://wa.me/519?text=Hola",
    });
  });

  it("otros errores del servidor y la falta de conexión", async () => {
    expect(await cancelarDesdeElPerfil(ID, { pedir: async () => error(409, "conflicto", "Esa limpieza ya se realizó, así que no se puede cancelar."), candado: { enCurso: null } })).toEqual({
      tipo: "error",
      mensaje: "Esa limpieza ya se realizó, así que no se puede cancelar.",
    });
    expect(await cancelarDesdeElPerfil(ID, { pedir: async () => Promise.reject(new Error("red")), candado: { enCurso: null } })).toEqual({ tipo: "error", mensaje: MENSAJE_SIN_CONEXION });
  });
});

describe("reprogramarDesdeElPerfil", () => {
  const ok = { reserva: { inicio: "2026-11-06T10:00:00-05:00", fin: "2026-11-06T14:00:00-05:00", estado: "pendiente" } };

  it("envía solo el nuevo inicio y devuelve el horario nuevo", async () => {
    const pedir = vi.fn(async (_u: string, _i?: RequestInit) => json(ok));
    const r = await reprogramarDesdeElPerfil(ID, "2026-11-06T10:00:00-05:00", { pedir, candado: { enCurso: null } });
    expect(pedir.mock.calls[0][0]).toBe(`/api/reservas/${ID}/reprogramar`);
    expect(JSON.parse(String(pedir.mock.calls[0][1]?.body))).toEqual({ inicio: "2026-11-06T10:00:00-05:00" });
    expect(r).toEqual({ tipo: "ok", inicio: "2026-11-06T10:00:00-05:00", fin: "2026-11-06T14:00:00-05:00", pendiente: true });
  });

  it("doble clic: una sola llamada", async () => {
    let liberar!: (r: Response) => void;
    const pedir = vi.fn(() => new Promise<Response>((r) => (liberar = r)));
    const candado = { enCurso: null };
    const a = reprogramarDesdeElPerfil(ID, "x", { pedir, candado });
    const b = reprogramarDesdeElPerfil(ID, "x", { pedir, candado });
    liberar(json(ok));
    await Promise.all([a, b]);
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it("409 fuera_de_plazo", async () => {
    const pedir = async () => error(409, "fuera_de_plazo", "m", { whatsapp: null });
    expect(await reprogramarDesdeElPerfil(ID, "x", { pedir, candado: { enCurso: null } })).toEqual({ tipo: "fuera_de_plazo", mensaje: "m", whatsapp: null });
  });

  it("409 sin cupo: vuelve a pedir otra hora", async () => {
    const pedir = async () => error(409, "conflicto", "Esa hora ya no está disponible. Elige otra hora.");
    expect(await reprogramarDesdeElPerfil(ID, "x", { pedir, candado: { enCurso: null } })).toEqual({ tipo: "sin_cupo", mensaje: "Esa hora ya no está disponible. Elige otra hora." });
  });

  it("422 muestra el mensaje del servidor", async () => {
    const pedir = async () => error(422, "datos_invalidos", "Reserva con al menos 48 horas de anticipación.");
    expect(await reprogramarDesdeElPerfil(ID, "x", { pedir, candado: { enCurso: null } })).toEqual({ tipo: "error", mensaje: "Reserva con al menos 48 horas de anticipación." });
  });
});

describe("pedirHorariosDeReserva", () => {
  it("pide la disponibilidad de la reserva con la fecha", async () => {
    const pedir = vi.fn(async (_u: string, _i?: RequestInit) => json({ fecha: "2026-11-06", atendido: true, horarios: [] }));
    const r = await pedirHorariosDeReserva(ID, "2026-11-06", pedir);
    expect(pedir.mock.calls[0][0]).toBe(`/api/reservas/${ID}/disponibilidad?fecha=2026-11-06`);
    expect(r).toEqual({ tipo: "ok", disponibilidad: { fecha: "2026-11-06", atendido: true, horarios: [] } });
  });

  it("422 y falta de conexión", async () => {
    expect(await pedirHorariosDeReserva(ID, "2026-02-30", async () => error(422, "datos_invalidos", "Escribe una fecha válida con el formato AAAA-MM-DD."))).toEqual({
      tipo: "error",
      mensaje: "Escribe una fecha válida con el formato AAAA-MM-DD.",
    });
    expect(await pedirHorariosDeReserva(ID, "2026-11-06", async () => Promise.reject(new Error("red")))).toEqual({ tipo: "error", mensaje: MENSAJE_SIN_CONEXION });
  });
});
