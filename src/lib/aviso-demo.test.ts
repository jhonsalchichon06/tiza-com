import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AVISO_DEMOSTRACION } from "./aviso-demo";
import { CCI_TIZA } from "./reservas/datos-de-pago";

const RAIZ = resolve(__dirname, "../..");

function archivos(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (nombre === "node_modules" || nombre === ".next") return [];
    return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta];
  });
}

describe("aviso de demostración", () => {
  it("el texto es exactamente el que fija el PRD", () => {
    expect(AVISO_DEMOSTRACION).toBe("Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.");
  });

  it("no contiene dígitos, «S/», la CCI ni palabras de credenciales", () => {
    expect(AVISO_DEMOSTRACION).not.toMatch(/\d/);
    expect(AVISO_DEMOSTRACION).not.toContain("S/");
    expect(AVISO_DEMOSTRACION).not.toContain(CCI_TIZA);
    expect(AVISO_DEMOSTRACION).not.toMatch(/clave|token|secreto/i);
  });

  // Las pruebas de otros changes usan el texto como literal para comprobar el HTML: se excluyen los *.test.ts.
  it("ningún archivo de app/ ni de src/ (salvo pruebas) repite el texto", () => {
    const repetidos: string[] = [];
    for (const carpeta of ["app", "src"]) {
      for (const ruta of archivos(join(RAIZ, carpeta))) {
        if (!/\.(ts|tsx|js|jsx|css|json|md|html)$/.test(ruta) || /\.test\.(ts|tsx)$/.test(ruta) || ruta.endsWith("aviso-demo.ts")) continue;
        if (readFileSync(ruta, "utf8").includes(AVISO_DEMOSTRACION)) repetidos.push(ruta);
      }
    }
    expect(repetidos).toEqual([]);
  });
});
