import { describe, expect, it } from "vitest";
import { leerParametrosIniciales, rutaDeVolver } from "./parametros";

const PAQUETES = [3, 4, 6, 8];

describe("leerParametrosIniciales", () => {
  it("sin parámetros no preselecciona nada", () => {
    expect(leerParametrosIniciales({}, PAQUETES)).toEqual({ distrito: "", tipo: null, horas: null });
  });

  it("ignora un distrito vacío o que no es de v1", () => {
    expect(leerParametrosIniciales({ distrito: "" }, PAQUETES).distrito).toBe("");
    expect(leerParametrosIniciales({ distrito: "La Molina" }, PAQUETES).distrito).toBe("");
    expect(leerParametrosIniciales({ distrito: "Miraflores" }, PAQUETES).distrito).toBe("Miraflores");
  });

  it("ignora un tipo desconocido", () => {
    expect(leerParametrosIniciales({ tipo: "otro" }, PAQUETES).tipo).toBeNull();
  });

  it("acepta los tres servicios por tamaño", () => {
    for (const tipo of ["estandar", "profunda", "mudanza"] as const) {
      expect(leerParametrosIniciales({ tipo }, PAQUETES).tipo).toBe(tipo);
    }
  });

  it("traduce tipo=horas a paquete y valida las horas contra la configuración", () => {
    expect(leerParametrosIniciales({ tipo: "horas", horas: "6" }, PAQUETES)).toEqual({ distrito: "", tipo: "paquete", horas: 6 });
    expect(leerParametrosIniciales({ tipo: "horas", horas: "5" }, PAQUETES)).toEqual({ distrito: "", tipo: "paquete", horas: null });
    expect(leerParametrosIniciales({ tipo: "horas" }, PAQUETES).horas).toBeNull();
  });

  it("horas=5 solo (sin tipo=horas) se ignora", () => {
    expect(leerParametrosIniciales({ horas: "5" }, PAQUETES)).toEqual({ distrito: "", tipo: null, horas: null });
    expect(leerParametrosIniciales({ horas: "6" }, PAQUETES).horas).toBeNull();
  });

  it("acepta club y no cambia nada", () => {
    expect(leerParametrosIniciales({ tipo: "horas", horas: "6", club: "1" }, PAQUETES)).toEqual({ distrito: "", tipo: "paquete", horas: 6 });
  });

  it("con parámetros repetidos usa el primero", () => {
    expect(leerParametrosIniciales({ tipo: ["profunda", "mudanza"], distrito: ["Lince", "Barranco"] }, PAQUETES)).toEqual({
      distrito: "Lince",
      tipo: "profunda",
      horas: null,
    });
  });
});

describe("rutaDeVolver", () => {
  it("conserva los parámetros", () => {
    expect(rutaDeVolver({ tipo: "profunda" })).toBe("/reservar?tipo=profunda");
    expect(rutaDeVolver({ distrito: "Santiago de Surco", tipo: "horas", horas: "6" })).toBe(
      "/reservar?distrito=Santiago+de+Surco&tipo=horas&horas=6",
    );
  });

  it("sin parámetros es /reservar y conserva los repetidos", () => {
    expect(rutaDeVolver({})).toBe("/reservar");
    expect(rutaDeVolver({ tipo: ["a", "b"] })).toBe("/reservar?tipo=a&tipo=b");
  });
});
