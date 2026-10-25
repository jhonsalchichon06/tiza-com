import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Invariante del ADR 0009 y del design de #10: todo insert de una reserva pasa por `transaccionDeEscritura`
// (que marca las vencidas antes). La única llamada a `insert(reservas)` vive en `asignar.ts`.
const RAIZ = join(__dirname, "..", "..");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

const esDePrueba = (ruta: string) => /\.test\.tsx?$/.test(ruta) || /\.bd\.test\.ts$/.test(ruta) || ruta.endsWith("pruebas-bd.ts");

describe("único insert de reservas", () => {
  const fuentes = archivos(RAIZ).filter((r) => !esDePrueba(r));

  it("recorre archivos del código", () => {
    expect(fuentes.length).toBeGreaterThan(20);
  });

  it("solo src/lib/agenda/asignar.ts llama a insert(reservas)", () => {
    const con = fuentes.filter((r) => /insert\(\s*reservas\s*\)/.test(readFileSync(r, "utf8"))).map((r) => relative(RAIZ, r).replaceAll("\\", "/"));
    expect(con).toEqual(["lib/agenda/asignar.ts"]);
  });
});
