import { describe, expect, it } from "vitest";
import { esEditable, textoDeEstadoResena } from "./textos";

describe("textos de la reseña", () => {
  it("cada estado tiene su texto", () => {
    expect(textoDeEstadoResena("pendiente")).toBe("En revisión: aún no se muestra en la web");
    expect(textoDeEstadoResena("aprobada")).toBe("Publicada en la web");
    expect(textoDeEstadoResena("rechazada")).toBe("No se publicó. Puedes editarla y enviarla de nuevo");
  });

  it("solo la aprobada no se edita", () => {
    expect(esEditable("pendiente")).toBe(true);
    expect(esEditable("rechazada")).toBe(true);
    expect(esEditable("aprobada")).toBe(false);
  });
});
