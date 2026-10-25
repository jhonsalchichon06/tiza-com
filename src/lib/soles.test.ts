import { describe, expect, it } from "vitest";
import { formatearHoras, formatearSoles } from "./soles";

describe("formatearSoles", () => {
  it.each([
    [6600, "S/ 66"],
    [19350, "S/ 193,50"],
    [6966, "S/ 69,66"],
    [33666, "S/ 336,66"],
    [26700, "S/ 267"],
    [5, "S/ 0,05"],
  ])("%i céntimos → %s", (centimos, texto) => {
    expect(formatearSoles(centimos)).toBe(texto);
  });
});

describe("formatearHoras", () => {
  it.each([
    [1, "1 hora"],
    [3, "3 horas"],
    [3.5, "3,5 horas"],
  ])("%d → %s", (horas, texto) => {
    expect(formatearHoras(horas)).toBe(texto);
  });
});
