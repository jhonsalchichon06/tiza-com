import { describe, expect, it } from "vitest";
import { DISTRITOS, esDistrito } from "./distritos";

describe("DISTRITOS", () => {
  it("tiene exactamente los 9 distritos de v1, incluido San Luis", () => {
    expect([...DISTRITOS].sort()).toEqual(
      [
        "Barranco",
        "Jesús María",
        "Lince",
        "Miraflores",
        "San Borja",
        "San Isidro",
        "San Luis",
        "San Miguel",
        "Santiago de Surco",
      ].sort(),
    );
    expect(DISTRITOS).toHaveLength(9);
  });

  it.each(["La Molina", "Magdalena", "Pueblo Libre", "Chorrillos"])("no incluye %s", (distrito) => {
    expect(esDistrito(distrito)).toBe(false);
  });

  it("solo acepta el nombre exacto", () => {
    expect(esDistrito("Miraflores")).toBe(true);
    expect(esDistrito("miraflores")).toBe(false);
    expect(esDistrito(undefined)).toBe(false);
  });
});
