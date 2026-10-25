import { describe, expect, it } from "vitest";
import { textoSinGratis } from "./sin-gratis";

describe("textoSinGratis", () => {
  it("sin motivo no hay texto", () => {
    expect(textoSinGratis(null)).toBeNull();
  });

  it("el motivo cliente habla de la cuenta", () => {
    expect(textoSinGratis("cliente")).toMatch(/Tu cuenta ya tiene una limpieza gratis/);
  });

  it("el motivo hogar habla de la dirección", () => {
    expect(textoSinGratis("hogar")).toMatch(/Otra cuenta ya recibió la limpieza gratis de esta dirección/);
  });

  it("no escribe montos ni porcentajes (los pone el servidor)", () => {
    for (const m of ["cliente", "hogar"] as const) expect(textoSinGratis(m)).not.toMatch(/S\/|%|\d/);
  });
});
