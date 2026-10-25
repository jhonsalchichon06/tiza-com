import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { planDeRenovacion } from "./plan";

describe("planDeRenovacion", () => {
  it("con los valores actuales: 3 meses por S/ 267 (26700 céntimos)", () => {
    expect(planDeRenovacion(VALORES_DEL_DISENO)).toEqual({ meses: 3, monto: 26700 });
  });

  it("sigue a la configuración: 2 meses a S/ 100 al mes dan S/ 200", () => {
    expect(planDeRenovacion({ membresia_precio_mensual: 10000, membresia_meses: 2 })).toEqual({ meses: 2, monto: 20000 });
  });
});
