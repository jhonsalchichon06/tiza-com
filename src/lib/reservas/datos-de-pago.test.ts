import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CCI_TIZA, RUTA_QR_YAPE, TITULAR_TIZA } from "./datos-de-pago";

const RAIZ = resolve(__dirname, "../../..");
const EXTENSIONES = /\.(ts|tsx|js|jsx|css|json|md|html)$/;
const ESTE_MODULO = ["datos-de-pago.ts", "datos-de-pago.test.ts"];

function archivos(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (nombre === "node_modules" || nombre === ".next") return [];
    return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta];
  });
}

describe("datos de pago", () => {
  it("la CCI son exactamente 20 dígitos", () => {
    expect(CCI_TIZA).toMatch(/^\d{20}$/);
  });

  it("el titular no está vacío", () => {
    expect(TITULAR_TIZA.trim().length).toBeGreaterThan(0);
  });

  it("el QR de Yape existe en public/ y es un JPEG", () => {
    const archivo = join(RAIZ, "public", ...RUTA_QR_YAPE.split("/").filter(Boolean));
    expect(existsSync(archivo)).toBe(true);
    const inicio = readFileSync(archivo).subarray(0, 2);
    expect([...inicio]).toEqual([0xff, 0xd8]);
  });

  it("ningún otro archivo de app/ ni de src/ repite la CCI, el titular ni la ruta de la imagen", () => {
    const repetidos: string[] = [];
    for (const carpeta of ["app", "src"]) {
      for (const ruta of archivos(join(RAIZ, carpeta))) {
        if (!EXTENSIONES.test(ruta) || ESTE_MODULO.some((m) => ruta.endsWith(m))) continue;
        const texto = readFileSync(ruta, "utf8");
        for (const valor of [CCI_TIZA, TITULAR_TIZA, RUTA_QR_YAPE]) {
          if (texto.includes(valor)) repetidos.push(`${ruta}: ${valor.slice(0, 6)}…`);
        }
      }
    }
    expect(repetidos).toEqual([]);
  });
});
