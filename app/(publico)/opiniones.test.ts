import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "@/lib/__fixtures__/configuracion";
import { construirCatalogo } from "@/lib/catalogo-publico";
import type { Opinion } from "@/lib/resenas/publicas";

const { leerOpiniones } = vi.hoisted(() => ({ leerOpiniones: vi.fn() }));
vi.mock("@/lib/resenas/publicas", () => ({ leerOpiniones }));
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "f" }), Inter: () => ({ variable: "i" }) }));

import LayoutPublico from "./layout";
import { Landing } from "./_componentes/Landing";

const catalogo = construirCatalogo(VALORES_DEL_DISENO);
const opinion = (extra: Partial<Opinion> = {}): Opinion => ({
  nombrePila: "María",
  distrito: "Miraflores",
  estrellas: 5,
  comentario: "Dejaron mi casa impecable, muy puntuales.",
  mes: "octubre de 2026",
  ...extra,
});
const landing = (opiniones?: Opinion[]) => renderToStaticMarkup(createElement(Landing, { catalogo, opiniones }));
const secciones = (html: string) => (html.match(/<section/g) ?? []).length;
const layout = async () => renderToStaticMarkup(await LayoutPublico({ children: null }));

describe("landing sin opiniones", () => {
  it("sigue con 9 secciones, sin id=opiniones ni la palabra Opiniones", () => {
    for (const html of [landing(), landing([])]) {
      expect(secciones(html)).toBe(9);
      expect(html).not.toContain('id="opiniones"');
      expect(html).not.toContain("Opiniones");
      expect(html).not.toContain("Opiniones de clientes");
    }
  });
});

describe("landing con opiniones", () => {
  it("dos opiniones: 10 secciones, dos tarjetas, entre Tiza Club y Distritos, sin apellidos", () => {
    const html = landing([opinion(), opinion({ nombrePila: "Luis", distrito: "Lince", estrellas: 4, comentario: "Todo muy bien, gracias." })]);
    expect(secciones(html)).toBe(10);
    expect(html).toContain('id="opiniones"');
    expect(html).toContain("Opiniones de clientes");
    const seccion = html.slice(html.indexOf('id="opiniones"'), html.indexOf('id="distritos"'));
    expect((seccion.match(/<li /g) ?? []).length).toBe(2);
    expect(html.indexOf('id="club"')).toBeLessThan(html.indexOf('id="opiniones"'));
    expect(html.indexOf('id="opiniones"')).toBeLessThan(html.indexOf('id="distritos"'));
    expect(html).toContain("María");
    expect(html).toContain("Lince");
    expect(html).toContain('aria-label="5 de 5 estrellas"');
    expect(html).toContain('aria-label="4 de 5 estrellas"');
    expect(html).not.toMatch(/Quispe|Rojas|@tiza\.test/);
  });

  it("un comentario con HTML sale escapado", () => {
    const html = landing([opinion({ comentario: "<script>alert(1)</script> y <b>negrita</b>" })]);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>negrita</b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("menú de las páginas públicas", () => {
  beforeEach(() => leerOpiniones.mockReset());

  it("muestra «Opiniones» (a /#opiniones) solo si hay reseñas", async () => {
    leerOpiniones.mockResolvedValue([opinion()]);
    const con = await layout();
    expect(con).toContain('href="/#opiniones"');
    expect(con).toContain(">Opiniones<");
    leerOpiniones.mockResolvedValue([]);
    const sin = await layout();
    expect(sin).not.toContain("Opiniones");
    expect(sin).not.toContain("#opiniones");
  });
});

describe("fuentes de las opiniones", () => {
  const RAIZ = resolve(__dirname, "../..");
  const fuentes = [
    join(RAIZ, "app/(publico)/_componentes/Opiniones.tsx"),
    join(RAIZ, "app/(publico)/_componentes/Landing.tsx"),
    join(RAIZ, "app/(publico)/layout.tsx"),
    join(RAIZ, "app/(publico)/page.tsx"),
    join(RAIZ, "app/(cuenta)/cuenta/reservas/[id]/ResenaDelServicio.tsx"),
    join(RAIZ, "app/admin/resenas/VistaResenas.tsx"),
    join(RAIZ, "src/lib/resenas/publicas.ts"),
  ];

  it.each(fuentes)("%s no usa dangerouslySetInnerHTML", (archivo) => {
    expect(readFileSync(archivo, "utf8")).not.toContain("dangerouslySetInnerHTML");
  });

  it("la página y el layout siguen sin cookies() ni headers() y con revalidate = 300", () => {
    const pagina = readFileSync(join(RAIZ, "app/(publico)/page.tsx"), "utf8");
    const layoutFuente = readFileSync(join(RAIZ, "app/(publico)/layout.tsx"), "utf8");
    expect(pagina).toMatch(/export const revalidate = 300/);
    for (const codigo of [pagina, layoutFuente]) expect(codigo.replace(/^\s*\/\/.*$/gm, "")).not.toMatch(/cookies\(|headers\(/);
  });
});
