import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "@/lib/__fixtures__/configuracion";
import { construirCatalogo } from "@/lib/catalogo-publico";
import type { Configuracion } from "@/lib/configuracion";
import { DISTRITOS } from "@/lib/distritos";
import { Landing } from "./_componentes/Landing";
import { PaginaPreguntas } from "./_componentes/PaginaPreguntas";

const catalogo = (cambios: Partial<Configuracion> = {}) => construirCatalogo({ ...VALORES_DEL_DISENO, ...cambios });
const landing = (cambios?: Partial<Configuracion>) => renderToStaticMarkup(createElement(Landing, { catalogo: catalogo(cambios) }));
const preguntas = (cambios?: Partial<Configuracion>) =>
  renderToStaticMarkup(createElement(PaginaPreguntas, { catalogo: catalogo(cambios) }));

describe("landing", () => {
  it("trae las 9 secciones y los 9 distritos, sin scripts", () => {
    const html = landing();
    expect((html.match(/<section/g) ?? []).length).toBe(9);
    for (const id of ["como-funciona", "servicios", "paquetes", "club", "distritos", "faq"]) expect(html).toContain(`id="${id}"`);
    for (const d of DISTRITOS) expect(html).toContain(d);
    for (const fuera of ["La Molina", "Magdalena", "Pueblo Libre", "Chorrillos"]) expect(html).not.toContain(fuera);
    expect(html).not.toContain("<script");
  });

  it("no trae opiniones de ejemplo ni frases sin respaldo", () => {
    for (const html of [landing(), preguntas()]) {
      for (const frase of [
        "Cliente de ejemplo", "Lo que dicen nuestros clientes", "Testimonios de ejemplo", "verificado", "Reprogramación gratis",
        "Trabaja con nosotros", "hola@tiza.com", "La Molina",
      ]) {
        expect(html).not.toContain(frase);
      }
    }
  });

  it("los enlaces a la reserva llevan los parámetros de la demo", () => {
    const html = landing();
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/reservar"');
    expect(html).toContain('name="distrito"');
    expect(html).toContain('name="tipo"');
    expect(html).toContain('href="/reservar?tipo=horas&amp;horas=6"');
    expect(html).toContain('href="/reservar?club=1"');
    for (const tipo of ["estandar", "profunda", "mudanza"]) expect(html).toContain(`href="/reservar?tipo=${tipo}"`);
  });

  it("muestra los precios de los datos y cambian al cambiar los datos", () => {
    const html = landing();
    for (const t of ["S/ 66", "S/ 99", "S/ 112,20", "S/ 32,25 por hora", "Mejor precio por hora"]) expect(html).toContain(t);
    expect((html.match(/Mejor precio por hora/g) ?? []).length).toBe(1);
    const otro = landing({ precios_niveles: [7000, 9900, 12900, 18900], descuento_miembro: 0.2 });
    expect(otro).toContain("S/ 70");
    expect(otro).toContain("20%");
    expect(otro).not.toContain("10%");
  });

  it("no muestra el monto de la membresía y no cambia al editarlo", () => {
    for (const render of [landing, preguntas]) {
      const html = render();
      expect(html).not.toMatch(/S\/ ?(89|267)\b/);
      expect(html).not.toContain("al mes");
      expect(render({ membresia_precio_mensual: 9900 })).toBe(html);
    }
  });

  it("la lista de preguntas es la misma en la landing y en /preguntas, con <details>", () => {
    const lista = (html: string) => html.match(/<details>.*<\/details>/s)?.[0];
    const a = lista(landing());
    expect(a).toBeTruthy();
    expect(a).toContain("<summary>");
    expect(lista(preguntas())).toBe(a);
    expect(preguntas()).not.toContain("<script");
    expect(preguntas()).toContain('href="/"');
  });
});

// Ninguna cifra de dinero ni de horas escrita a mano en las páginas públicas (ADR 0008).
describe("sin cifras escritas a mano", () => {
  const RAIZ = resolve(__dirname, "../..");
  const archivos = (carpeta: string): string[] =>
    readdirSync(carpeta).flatMap((n) => {
      const ruta = join(carpeta, n);
      return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta];
    });
  const fuentes = [...archivos(__dirname), join(RAIZ, "src/lib/preguntas.ts")].filter(
    (f) => /\.tsx?$/.test(f) && !/\.test\.ts$/.test(f),
  );

  it("encuentra los fuentes", () => {
    expect(fuentes.length).toBeGreaterThan(6);
  });

  it.each(fuentes)("%s", (archivo) => {
    const codigo = readFileSync(archivo, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      // Excepción: el plazo de cancelar o reprogramar no es un parámetro todavía (lo define el ítem #12).
      .replaceAll("hasta 24 horas antes", "");
    expect(codigo).not.toMatch(/S\/ ?\d/);
    expect(codigo).not.toMatch(/\b10 ?%/);
    expect(codigo).not.toMatch(/\b(48|24)\b/);
  });
});
