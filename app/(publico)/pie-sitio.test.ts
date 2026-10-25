import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AVISO_DEMOSTRACION } from "@/lib/aviso-demo";
import { PieSitio } from "./_componentes/PieSitio";

const TEXTO = "Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.";
const leer = (ruta: string) => readFileSync(resolve(__dirname, ruta), "utf8");

describe("PieSitio", () => {
  it.each([[null], ["https://wa.me/51912345678?text=Hola"]])("muestra el aviso exacto en un bloque role=note (WhatsApp: %s)", (whatsapp) => {
    expect(AVISO_DEMOSTRACION).toBe(TEXTO);
    const html = renderToStaticMarkup(createElement(PieSitio, { whatsapp }));
    expect(html).toMatch(new RegExp(`<p[^>]*role="note"[^>]*>${TEXTO}</p>`));
    expect(html.includes("wa.me")).toBe(whatsapp !== null);
  });

  it("el layout renderiza el pie y las páginas no lo repiten", () => {
    const layout = leer("layout.tsx");
    expect(layout).toMatch(/import \{ PieSitio \} from/);
    expect(layout).toContain("<PieSitio");
    expect(layout).toContain("process.env.WHATSAPP_NUMERO");
    expect(layout.replace(/^\s*\/\/.*$/gm, "")).not.toMatch(/cookies\(|headers\(/);
    for (const pagina of ["page.tsx", "preguntas/page.tsx", "_componentes/Landing.tsx", "_componentes/PaginaPreguntas.tsx"]) {
      expect(leer(pagina)).not.toContain("PieSitio");
    }
  });

  it("ningún archivo de app/ repite el texto del aviso", () => {
    const raiz = resolve(__dirname, "..");
    const archivos = (c: string): string[] =>
      readdirSync(c).flatMap((n) => {
        const r = join(c, n);
        return statSync(r).isDirectory() ? archivos(r) : [r];
      });
    const repetidos = archivos(raiz).filter((f) => !/\.test\.ts$/.test(f) && readFileSync(f, "utf8").includes(TEXTO));
    expect(repetidos).toEqual([]);
  });
});
