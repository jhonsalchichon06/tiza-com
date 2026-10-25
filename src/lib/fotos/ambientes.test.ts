import { describe, expect, it } from "vitest";
import { AMBIENTES, esAmbiente, etiquetaDeAmbiente } from "./ambientes";

describe("ambientes de las fotos", () => {
  it("son los siete valores de la lista cerrada, en ese orden", () => {
    expect([...AMBIENTES]).toEqual(["cocina", "bano", "dormitorio", "sala", "comedor", "lavanderia", "otro"]);
  });

  it("las etiquetas están en español de Perú, con tilde", () => {
    expect(etiquetaDeAmbiente("cocina")).toBe("Cocina");
    expect(etiquetaDeAmbiente("bano")).toBe("Baño");
    expect(etiquetaDeAmbiente("lavanderia")).toBe("Lavandería");
    expect(etiquetaDeAmbiente("otro")).toBe("Otro");
  });

  it("garaje no es un ambiente", () => {
    expect(esAmbiente("garaje")).toBe(false);
    expect(esAmbiente(undefined)).toBe(false);
    expect(esAmbiente("Cocina")).toBe(false);
  });

  it.each([...AMBIENTES])("%s es un ambiente", (a) => expect(esAmbiente(a)).toBe(true));

  it("un valor desconocido guardado en la base se muestra como «Otro»", () => {
    expect(etiquetaDeAmbiente("garaje")).toBe("Otro");
  });
});
