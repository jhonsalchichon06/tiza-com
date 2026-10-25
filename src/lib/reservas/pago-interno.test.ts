import { describe, expect, it } from "vitest";
import { crearPagoInterno } from "./pago-interno";

describe("crearPagoInterno", () => {
  it("inserta método credito, monto 0, aprobado, sin membresía, comprobante ni revisor", async () => {
    let valores: Record<string, unknown> | undefined;
    const tx = {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          valores = v;
          return { returning: async () => [{ id: "p1", ...v }] };
        },
      }),
    };
    const pago = await crearPagoInterno(tx as never, { usuarioId: "u1", concepto: "reserva" });
    expect(valores).toEqual({ usuarioId: "u1", concepto: "reserva", membresiaId: null, monto: 0, metodo: "credito", comprobanteRuta: null, estado: "aprobado" });
    expect(pago.id).toBe("p1");
    expect(valores).not.toHaveProperty("revisadoPor");
  });

  it("nunca guarda una ruta de comprobante", async () => {
    let valores: Record<string, unknown> = {};
    const tx = { insert: () => ({ values: (v: Record<string, unknown>) => ((valores = v), { returning: async () => [v] }) }) };
    await crearPagoInterno(tx as never, { usuarioId: "u2", concepto: "reserva" });
    expect(valores.comprobanteRuta).toBeNull();
  });
});
