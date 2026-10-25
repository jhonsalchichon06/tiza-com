import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "./__fixtures__/configuracion";
import { CLAVES_CONFIGURACION, validarParametro } from "./configuracion";

describe("validarParametro", () => {
  it("define exactamente las 20 claves del diseño", () => {
    expect([...CLAVES_CONFIGURACION].sort()).toEqual(Object.keys(VALORES_DEL_DISENO).sort());
  });

  it("la cuenta de claves es 20", () => expect(CLAVES_CONFIGURACION).toHaveLength(20));

  it.each([0, -1, 7.5, "7"])("rechaza %j como reenvio_comprobante_dias, nombrando la clave", (valor) => {
    expect(() => validarParametro("reenvio_comprobante_dias", valor)).toThrow(/reenvio_comprobante_dias/);
  });

  it.each([0, -1, 24.5, "24"])("rechaza %j como cancelacion_minima_horas, nombrando la clave", (valor) => {
    expect(() => validarParametro("cancelacion_minima_horas", valor)).toThrow(/cancelacion_minima_horas/);
  });

  it.each([0, -1, 14.5, "14"])("rechaza %j como renovacion_aviso_dias, nombrando la clave", (valor) => {
    expect(() => validarParametro("renovacion_aviso_dias", valor)).toThrow(/renovacion_aviso_dias/);
  });

  it.each([0, -1, 12.5, "12"])("rechaza %j como fotos_maximas_por_reserva, nombrando la clave", (valor) => {
    expect(() => validarParametro("fotos_maximas_por_reserva", valor)).toThrow(/fotos_maximas_por_reserva/);
  });

  it.each(CLAVES_CONFIGURACION)("acepta el valor del diseño para %s", (clave) => {
    expect(validarParametro(clave, VALORES_DEL_DISENO[clave])).toEqual(VALORES_DEL_DISENO[clave]);
  });

  it("rechaza un texto donde se espera un número, nombrando la clave", () => {
    expect(() => validarParametro("anticipacion_minima_horas", "48")).toThrow(/anticipacion_minima_horas/);
  });

  it("rechaza un objeto incompleto, nombrando la clave", () => {
    expect(() => validarParametro("multiplicadores_precio", { estandar: 1, profunda: 1.5 })).toThrow(
      /multiplicadores_precio/,
    );
  });

  it.each([
    ["membresia_precio_mensual", 89.5],
    ["precios_niveles", [6600, 99.5, 12900, 18900]],
    ["paquetes_horas", [{ horas: 3, precio: 99.9 }]],
  ] as const)("exige montos en céntimos enteros en %s", (clave, valor) => {
    expect(() => validarParametro(clave, valor)).toThrow(new RegExp(clave));
  });

  it("rechaza una hora del día mal escrita", () => {
    expect(() =>
      validarParametro("horario_atencion", { ...VALORES_DEL_DISENO.horario_atencion, cierre: "6pm" }),
    ).toThrow(/horario_atencion/);
  });

  it("rechaza una clave desconocida", () => {
    expect(() => validarParametro("no_existe" as never, 1)).toThrow(/no_existe/);
  });
});
