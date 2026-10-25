import { describe, expect, it } from "vitest";
import { formatearFecha, formatearFechaHora, formatearHora, hora12 } from "./textos";

describe("fechas del perfil", () => {
  it("fecha y hora en hora de Lima, en español", () => {
    expect(formatearFechaHora(new Date("2026-12-15T15:00:00Z"), "America/Lima")).toBe("martes 15 de diciembre, 10:00 am");
  });
  it("acepta el texto ISO con desfase", () => {
    expect(formatearFechaHora("2026-12-15T15:30:00-05:00", "America/Lima")).toBe("martes 15 de diciembre, 3:30 pm");
  });
  it("solo fecha y solo hora", () => {
    expect(formatearFecha(new Date("2026-12-15T15:00:00Z"), "America/Lima")).toBe("15 de diciembre de 2026");
    expect(formatearHora(new Date("2026-12-15T15:00:00Z"), "America/Lima")).toBe("10:00 am");
  });
  it.each([["00:00", "12:00 am"], ["12:00", "12:00 pm"], ["13:05", "1:05 pm"], ["08:30", "8:30 am"]])("hora12(%s)", (e, s) => {
    expect(hora12(e)).toBe(s);
  });
});
