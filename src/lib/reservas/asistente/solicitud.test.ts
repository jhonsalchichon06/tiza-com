import { describe, expect, it } from "vitest";
import { MIEMBRO_ESTANDAR_2_1, MIEMBRO_SIN_COSTO } from "./__dobles__/cotizaciones";
import { estadoInicial, reductor, type Accion, type Estado } from "./estado";
import { construirCuerpo } from "./solicitud";

const aplicar = (estado: Estado, ...acciones: Accion[]) => acciones.reduce(reductor, estado);
const HORARIO = { hora: "09:00", inicio: "2026-11-09T09:00:00-05:00" };
const DIRECCION = { distrito: "Barranco", calle: "  Jr. junín ", numero: "45", departamento: "", referencias: "" };

const armar = (...acciones: Accion[]) =>
  aplicar(
    estadoInicial({ distrito: "", tipo: null, horas: null }),
    ...acciones,
    { tipo: "elegir_horario", horario: HORARIO },
    { tipo: "cambiar_direccion", direccion: DIRECCION },
    { tipo: "elegir_metodo", metodo: "transferencia" },
  );

describe("construirCuerpo", () => {
  it("arma el servicio por tamaño con 0 dormitorios como 0", () => {
    const cuerpo = construirCuerpo(
      armar({ tipo: "elegir_servicio", servicio: "estandar" }, { tipo: "fijar_dormitorios", valor: 0 }),
      "comprobantes/u1/1.webp",
    );
    expect(cuerpo.servicio).toEqual({ tipo: "estandar", dormitorios: 0, banos: 1 });
    expect(cuerpo.inicio).toBe(HORARIO.inicio);
    expect(cuerpo.metodo).toBe("transferencia");
    expect(cuerpo.comprobante).toBe("comprobantes/u1/1.webp");
  });

  it("un paquete usa tipo paquete y sus horas", () => {
    const cuerpo = construirCuerpo(armar({ tipo: "elegir_servicio", servicio: "paquete" }, { tipo: "elegir_paquete", horas: 6 }), "c/1.jpg");
    expect(cuerpo.servicio).toEqual({ tipo: "paquete", horas: 6 });
  });

  it("no envía ningún monto, descuento ni horas gratis", () => {
    const cuerpo = construirCuerpo(armar({ tipo: "elegir_servicio", servicio: "profunda" }), "c/1.jpg");
    expect(Object.keys(cuerpo).sort()).toEqual(["comprobante", "direccion", "inicio", "metodo", "servicio"]);
    expect(JSON.stringify(cuerpo)).not.toMatch(/monto|precio|descuento|gratis/);
  });

  it("envía la dirección sin normalizar y el departamento vacío como vacío", () => {
    const cuerpo = construirCuerpo(armar({ tipo: "elegir_servicio", servicio: "profunda" }), "c/1.jpg");
    expect(cuerpo.direccion).toEqual(DIRECCION);
    expect(cuerpo.direccion.departamento).toBe("");
  });

  it("falla con un error claro si falta el horario o el servicio", () => {
    expect(() => construirCuerpo(estadoInicial({ distrito: "", tipo: null, horas: null }), "c/1.jpg")).toThrow();
  });
});

describe("construirCuerpo en modo miembro", () => {
  const sinCostoEstado = () =>
    aplicar(
      estadoInicial({ distrito: "", tipo: null, horas: null }),
      { tipo: "elegir_servicio", servicio: "estandar" },
      { tipo: "cotizacion_lista", cotizacion: MIEMBRO_SIN_COSTO() },
      { tipo: "elegir_horario", horario: HORARIO },
      { tipo: "cambiar_direccion", direccion: DIRECCION },
    );

  it("con monto 0 omite método y comprobante y no lleva ningún monto", () => {
    const cuerpo = construirCuerpo(sinCostoEstado(), null);
    expect(Object.keys(cuerpo).sort()).toEqual(["direccion", "inicio", "servicio"]);
    expect(JSON.stringify(cuerpo)).not.toMatch(/monto|precio|descuento|gratis|metodo|comprobante/);
  });

  it("con monto 0 ignora un método o una ruta ya elegidos", () => {
    const e = aplicar(sinCostoEstado(), { tipo: "elegir_metodo", metodo: "yape" });
    expect(construirCuerpo(e, "c/1.jpg")).not.toHaveProperty("comprobante");
  });

  it("con monto mayor que 0 sin comprobante falla con un error claro", () => {
    const e = aplicar(
      estadoInicial({ distrito: "", tipo: null, horas: null }),
      { tipo: "elegir_servicio", servicio: "estandar" },
      { tipo: "cotizacion_lista", cotizacion: MIEMBRO_ESTANDAR_2_1() },
      { tipo: "elegir_horario", horario: HORARIO },
      { tipo: "cambiar_direccion", direccion: DIRECCION },
      { tipo: "elegir_metodo", metodo: "yape" },
    );
    expect(() => construirCuerpo(e, null)).toThrow();
    expect(construirCuerpo(e, "c/1.jpg")).toMatchObject({ metodo: "yape", comprobante: "c/1.jpg" });
  });
});
