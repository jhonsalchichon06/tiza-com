import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Los precios, el descuento de miembro y los plazos son datos de `configuracion` (PRD, alcance 4). Esta prueba de lectura
// recorre el código de `app/` y de `src/lib/reservas/` (sin pruebas ni dobles) y falla si alguien escribe una cifra a mano.
function archivosDe(directorio: string): string[] {
  return readdirSync(directorio).flatMap((nombre) => {
    const ruta = join(directorio, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "__dobles__" || nombre === "node_modules" ? [] : archivosDe(ruta);
    return /\.(ts|tsx)$/.test(nombre) && !/\.test\.ts$/.test(nombre) ? [ruta] : [];
  });
}

// Quita los comentarios: una cifra en un comentario explicativo no es una constante del producto.
const sinComentarios = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("ninguna cifra de precio, descuento o plazo escrita en app/ ni en src/lib/reservas/", () => {
  const raiz = process.cwd();
  const fuentes = [...archivosDe(join(raiz, "app")), ...archivosDe(join(raiz, "src", "lib", "reservas"))].map((ruta) => ({
    ruta,
    texto: sinComentarios(readFileSync(ruta, "utf8")),
  }));

  it("hay archivos que revisar", () => {
    expect(fuentes.length).toBeGreaterThan(40);
  });

  it("ningún archivo escribe un precio en soles", () => {
    expect(fuentes.filter((f) => /S\/ ?\d/.test(f.texto)).map((f) => f.ruta)).toEqual([]);
  });

  it("ningún archivo escribe el descuento de miembro (un porcentaje o 0,9 / 0.9)", () => {
    expect(fuentes.filter((f) => /\b(10|15) ?%|\b0[.,]9\b|\b0[.,]1\b/.test(f.texto)).map((f) => f.ruta)).toEqual([]);
  });

  it("ningún archivo escribe el monto de la membresía ni el plazo de la espera del pago", () => {
    expect(fuentes.filter((f) => /\b267\b|\b26700\b|\b8900\b|\b89\b/.test(f.texto)).map((f) => f.ruta)).toEqual([]);
    expect(fuentes.filter((f) => /espera_pago_horas\s*[:=]\s*\d|\b24 horas\b/.test(f.texto)).map((f) => f.ruta)).toEqual([]);
  });
});
