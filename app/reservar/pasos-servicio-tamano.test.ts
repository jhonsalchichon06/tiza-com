import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ESTANDAR_0_1, PAQUETES_DE_PRUEBA, PROFUNDA_2_1, PROFUNDA_3_2 } from "@/lib/reservas/asistente/__dobles__/cotizaciones";
import { PasoServicio } from "./PasoServicio";
import { PasoTamano, type PaqueteDeHoras } from "./PasoTamano";

const PAQUETES: PaqueteDeHoras[] = PAQUETES_DE_PRUEBA.map((horas) => ({ horas, precio: horas * 3300 }));
const nada = () => {};

const tamano = (propiedades: Partial<Parameters<typeof PasoTamano>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(PasoTamano, {
      tipo: "profunda",
      dormitorios: 2,
      banos: 1,
      horasPaquete: null,
      paquetes: PAQUETES,
      cotizacion: null,
      cargando: false,
      errorDeCotizacion: null,
      onDormitorios: nada,
      onBanos: nada,
      onPaquete: nada,
      onReintentar: nada,
      ...propiedades,
    }),
  );

describe("PasoServicio", () => {
  it("ofrece los cuatro servicios y marca el elegido", () => {
    const html = renderToStaticMarkup(createElement(PasoServicio, { tipo: "profunda", onElegir: nada }));
    for (const nombre of ["Limpieza estándar", "Limpieza profunda", "Limpieza de mudanza", "Por horas"]) expect(html).toContain(nombre);
    expect((html.match(/type="radio"/g) ?? []).length).toBe(4);
    expect(html).toMatch(/value="profunda"[^>]*checked|checked[^>]*value="profunda"/);
  });
});

describe("PasoTamano", () => {
  it("permite 0 dormitorios (mínimo 0) y exige al menos 1 baño (mínimo 1)", () => {
    const html = tamano({ tipo: "estandar", dormitorios: 0, banos: 1, cotizacion: ESTANDAR_0_1() });
    expect(html).toMatch(/<input[^>]*min="0"[^>]*name="dormitorios"/);
    expect(html).toMatch(/<input[^>]*min="1"[^>]*name="banos"/);
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("2 horas");
    expect(html).toContain("S/ 66");
  });

  it("avisa con un mensaje claro cuando el valor está fuera de rango", () => {
    const html = tamano({ tipo: "estandar", dormitorios: -1, banos: 1 });
    expect(html).toContain('role="alert"');
    expect(html).toContain("dormitorios");
    expect(tamano({ tipo: "estandar", dormitorios: 1, banos: 0 })).toContain("al menos 1 baño");
  });

  it("la profunda de 2 dormitorios y 1 baño muestra 5 horas, S/ 193,50, 3 horas gratis y S/ 69,66", () => {
    const html = tamano({ cotizacion: PROFUNDA_2_1() });
    expect(html).toContain("5 horas");
    expect(html).toContain("S/ 193,50");
    expect(html).toContain("3 horas");
    expect(html).toContain("S/ 69,66");
    expect(html).not.toContain("persona de apoyo");
  });

  it("la profunda de 3 dormitorios y 2 baños avisa del apoyo y de que el precio no cambia", () => {
    const html = tamano({ dormitorios: 3, banos: 2, cotizacion: PROFUNDA_3_2() });
    expect(html).toContain("persona de apoyo");
    expect(html).toContain("El precio no cambia");
  });

  it("un paquete muestra los paquetes de la configuración y no pide dormitorios", () => {
    const html = tamano({ tipo: "paquete", horasPaquete: 6 });
    expect(html).not.toContain('name="dormitorios"');
    for (const horas of PAQUETES_DE_PRUEBA) expect(html).toContain(`value="${horas}"`);
    expect(html).toContain("6 horas");
  });

  it("muestra el estado de carga y el error de la cotización con la opción de reintentar", () => {
    expect(tamano({ cargando: true })).toContain("Calculando");
    const html = tamano({ errorDeCotizacion: "No pudimos conectar con Tiza." });
    expect(html).toContain("No pudimos conectar con Tiza.");
    expect(html).toContain("Intentar de nuevo");
  });
});
