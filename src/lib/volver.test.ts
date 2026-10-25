import { describe, expect, it } from "vitest";
import { destinoSeguro } from "./volver";

describe("destinoSeguro", () => {
  it.each(["/cuenta", "/admin", "/cuenta?tab=reservas"])("acepta la ruta interna %s", (ruta) => {
    expect(destinoSeguro(ruta)).toBe(ruta);
  });

  it.each(["//otro.com", "/\\otro.com", "https://otro.com", "javascript:alert(1)", "", null, undefined])(
    "rechaza %j y usa /cuenta",
    (valor) => {
      expect(destinoSeguro(valor)).toBe("/cuenta");
    },
  );
});
