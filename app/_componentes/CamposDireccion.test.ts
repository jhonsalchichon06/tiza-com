import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DISTRITOS } from "@/lib/distritos";
import { CamposDireccion, DIRECCION_VACIA } from "./CamposDireccion";

const html = () => renderToStaticMarkup(createElement(CamposDireccion, { valor: DIRECCION_VACIA, onCambio: () => {} }));

describe("CamposDireccion", () => {
  it("muestra la lista con los 9 distritos y los cinco campos", () => {
    const marcado = html();
    for (const distrito of DISTRITOS) expect(marcado).toContain(`<option value="${distrito}">`);
    expect((marcado.match(/<option /g) ?? []).length).toBe(DISTRITOS.length + 1); // + "Elige tu distrito"
    for (const nombre of ["distrito", "calle", "numero", "departamento", "referencias"]) {
      expect(marcado).toContain(`name="${nombre}"`);
    }
  });

  it("marca como opcionales solo el departamento y las referencias", () => {
    const marcado = html();
    expect(marcado).toContain("Departamento o interior (opcional)");
    expect(marcado).toContain("Referencias (opcional)");
    expect(marcado).not.toContain("Calle, avenida o jirón (opcional)");
    expect(marcado).not.toContain("Número (opcional)");
    expect((marcado.match(/required/g) ?? []).length).toBe(3); // distrito, calle y número
  });

  it("no carga mapas ni scripts externos", () => {
    const marcado = html().toLowerCase();
    expect(marcado).not.toContain("<script");
    expect(marcado).not.toContain("<iframe");
    expect(marcado).not.toContain("google");
    expect(marcado).not.toContain("maps");
  });

  it("muestra el valor recibido", () => {
    const marcado = renderToStaticMarkup(
      createElement(CamposDireccion, {
        valor: { distrito: "Barranco", calle: "Jr. Junín", numero: "45", departamento: "", referencias: "" },
        onCambio: () => {},
      }),
    );
    expect(marcado).toContain('value="Jr. Junín"');
    expect(marcado).toContain('value="45"');
  });
});
