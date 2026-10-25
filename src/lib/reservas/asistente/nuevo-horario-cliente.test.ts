import { describe, expect, it, vi } from "vitest";
import { ErrorDeApi, MENSAJE_SIN_CONEXION } from "./api-cliente";
import { confirmarNuevoHorario, pedirDisponibilidadNuevoHorario, pedirNuevoHorario, type CandadoNuevoHorario } from "./nuevo-horario-cliente";

const PAGO = "11111111-1111-4111-8111-111111111111";
const INICIO = "2026-11-07T10:00:00-05:00";
const json = (cuerpo: unknown, status: number) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
const error = (status: number, codigo: string, mensaje: string) => json({ error: { codigo, mensaje } }, status);
const CREADA = { reserva: { id: "r1", estado: "confirmada" }, pago: { id: PAGO }, whatsapp: null };

function montar(respuesta: () => Promise<Response> | Response) {
  const pedir = vi.fn(async (_url: string, _init?: RequestInit) => respuesta());
  const candado: CandadoNuevoHorario = { enCurso: null };
  return { pedir, candado, deps: { pedir, candado } };
}

describe("confirmarNuevoHorario", () => {
  it("201: ok, y envía solo el inicio a /api/pagos/:id/nuevo-horario", async () => {
    const { deps, pedir } = montar(() => json(CREADA, 201));
    expect(await confirmarNuevoHorario({ pagoId: PAGO, inicio: INICIO }, deps)).toEqual({ tipo: "ok", respuesta: CREADA });
    const [url, init] = pedir.mock.calls[0];
    expect(url).toBe(`/api/pagos/${PAGO}/nuevo-horario`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ inicio: INICIO });
  });

  it("409 conflicto: sin_cupo", async () => {
    const { deps } = montar(() => error(409, "conflicto", "Esa hora ya no está disponible. Elige otra hora."));
    expect(await confirmarNuevoHorario({ pagoId: PAGO, inicio: INICIO }, deps)).toEqual({ tipo: "sin_cupo", mensaje: "Esa hora ya no está disponible. Elige otra hora." });
  });

  it("409 pago_en_credito: en_credito", async () => {
    const { deps } = montar(() => error(409, "pago_en_credito", "Las horas de esa cancelación pasan a tu crédito. Úsalo en tu próxima reserva."));
    expect((await confirmarNuevoHorario({ pagoId: PAGO, inicio: INICIO }, deps)).tipo).toBe("en_credito");
  });

  it("422: error con el mensaje del servidor", async () => {
    const { deps } = montar(() => error(422, "datos_invalidos", "Reserva con al menos 48 horas de anticipación."));
    expect(await confirmarNuevoHorario({ pagoId: PAGO, inicio: INICIO }, deps)).toEqual({ tipo: "error", mensaje: "Reserva con al menos 48 horas de anticipación." });
  });

  it("otro 409 (el pago ya tiene una reserva) es un error con el mensaje, no un cupo agotado", async () => {
    const { deps } = montar(() => error(409, "en_espera", "Ese pago ya tiene una reserva asociada."));
    expect(await confirmarNuevoHorario({ pagoId: PAGO, inicio: INICIO }, deps)).toEqual({ tipo: "error", mensaje: "Ese pago ya tiene una reserva asociada." });
  });

  it("red caída: error con el mensaje de conexión", async () => {
    const { deps } = montar(() => {
      throw new TypeError("fetch failed");
    });
    expect(await confirmarNuevoHorario({ pagoId: PAGO, inicio: INICIO }, deps)).toEqual({ tipo: "error", mensaje: MENSAJE_SIN_CONEXION });
  });

  it("doble clic: una sola petición y el candado se libera", async () => {
    let liberar!: () => void;
    const espera = new Promise<void>((r) => (liberar = r));
    const { deps, pedir } = montar(async () => {
      await espera;
      return json(CREADA, 201);
    });
    const a = confirmarNuevoHorario({ pagoId: PAGO, inicio: INICIO }, deps);
    const b = confirmarNuevoHorario({ pagoId: PAGO, inicio: INICIO }, deps);
    liberar();
    expect(await a).toEqual(await b);
    expect(pedir).toHaveBeenCalledTimes(1);
    await confirmarNuevoHorario({ pagoId: PAGO, inicio: INICIO }, deps);
    expect(pedir).toHaveBeenCalledTimes(2);
  });
});

describe("pedirNuevoHorario y pedirDisponibilidadNuevoHorario", () => {
  it("piden los datos y la disponibilidad del día del pago", async () => {
    const pedir = vi.fn(async (_url: string) => json({ ok: true }, 200));
    await pedirNuevoHorario(PAGO, pedir);
    await pedirDisponibilidadNuevoHorario(PAGO, "2026-11-07", pedir);
    expect(pedir.mock.calls[0][0]).toBe(`/api/pagos/${PAGO}/nuevo-horario`);
    expect(pedir.mock.calls[1][0]).toBe(`/api/pagos/${PAGO}/nuevo-horario/disponibilidad?fecha=2026-11-07`);
  });

  it("un error del servidor sale como ErrorDeApi con su código", async () => {
    const pedir = async () => error(409, "pago_en_credito", "Las horas de esa cancelación pasan a tu crédito.");
    await expect(pedirNuevoHorario(PAGO, pedir)).rejects.toMatchObject({ status: 409, codigo: "pago_en_credito" });
    await expect(pedirNuevoHorario(PAGO, pedir)).rejects.toBeInstanceOf(ErrorDeApi);
  });

  it("la red caída da el mensaje de conexión", async () => {
    await expect(
      pedirNuevoHorario(PAGO, async () => {
        throw new TypeError("fetch failed");
      }),
    ).rejects.toMatchObject({ message: MENSAJE_SIN_CONEXION });
  });
});
