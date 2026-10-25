import { describe, expect, it } from "vitest";
import {
  formatearHoras,
  mensajeCreditoCubre,
  mensajeCreditoDevuelto,
  mensajeCreditoGenerado,
  mensajeCreditoParcial,
  mensajeCreditoPendiente,
  mensajesDeCancelacion,
} from "./textos";

const zona = "America/Lima";

describe("textos del crédito", () => {
  it("formatea las horas con plural y coma", () => {
    expect(formatearHoras(1)).toBe("1 hora");
    expect(formatearHoras(3.5)).toBe("3,5 horas");
    expect(formatearHoras(4)).toBe("4 horas");
  });

  it("crédito generado con la fecha en hora de Lima", () => {
    // 2099-03-01 03:00 UTC = 28 de febrero 22:00 en Lima
    expect(mensajeCreditoGenerado({ horas: 2.5, venceEn: new Date("2099-03-01T03:00:00Z"), zona })).toBe(
      "Te devolvimos 2,5 horas como crédito. Puedes usarlas hasta el 28 de febrero de 2099.",
    );
    expect(mensajeCreditoGenerado({ horas: 1, venceEn: "2099-06-15T15:00:00Z", zona })).toContain("Te devolvimos 1 hora como crédito");
  });

  it("pendiente, devuelto, cubre y parcial", () => {
    expect(mensajeCreditoPendiente()).toBe("Si se aprueba tu pago, las horas quedarán como crédito.");
    expect(mensajeCreditoDevuelto({ horas: 1 })).toContain("1 hora de crédito");
    expect(mensajeCreditoDevuelto({ horas: 3 })).toContain("3 horas de crédito");
    expect(mensajeCreditoCubre({ horas: 4 })).toBe("Tu crédito de 4 horas cubre esta limpieza.");
    expect(mensajeCreditoParcial({ horas: 1.5 })).toBe("Usaremos 1,5 horas de tu crédito.");
  });

  it("mensajes de cancelación: generado, pendiente, devuelto, ninguno", () => {
    const g = { generado_horas: 2, vence_en: "2099-06-15T15:00:00Z", devuelto_horas: 0 };
    expect(mensajesDeCancelacion({ credito: g, horasPagadas: 2, estadoPago: "aprobado", zona })).toHaveLength(1);
    expect(mensajesDeCancelacion({ credito: { generado_horas: 0, vence_en: null, devuelto_horas: 0 }, horasPagadas: 2, estadoPago: "pendiente", zona })).toEqual([mensajeCreditoPendiente()]);
    expect(mensajesDeCancelacion({ credito: { generado_horas: 0, vence_en: null, devuelto_horas: 2 }, horasPagadas: 0, estadoPago: "aprobado", zona })).toHaveLength(1);
    expect(mensajesDeCancelacion({ credito: { ...g, devuelto_horas: 1 }, horasPagadas: 2, estadoPago: "aprobado", zona })).toHaveLength(2);
    expect(mensajesDeCancelacion({ credito: null, horasPagadas: 0, estadoPago: null, zona })).toEqual([]);
    expect(mensajesDeCancelacion({ credito: undefined, horasPagadas: 0, estadoPago: "rechazado", zona })).toEqual([]);
  });
});
