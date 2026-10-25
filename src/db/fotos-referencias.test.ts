import { describe, expect, it } from "vitest";
import * as esquema from "./esquema";
import { fotosServicio, pagos } from "./esquema";
import { columnasDeRutaSinDeclarar, COLUMNAS_CON_IMAGEN, leerRutasReferenciadas } from "@/lib/imagenes/referencias";

// El cron de huérfanos borra todo archivo de Blob de más de 24 horas que ninguna columna declarada referencie. Si
// `fotos_servicio.ruta` no estuviera declarada, las fotos del servicio se borrarían al día siguiente.
describe("fotos_servicio.ruta en COLUMNAS_CON_IMAGEN", () => {
  it("está declarada y no queda ninguna columna de ruta sin declarar en el esquema real", () => {
    expect(COLUMNAS_CON_IMAGEN).toContainEqual({ tabla: fotosServicio, columna: fotosServicio.ruta });
    expect(columnasDeRutaSinDeclarar(esquema as Record<string, unknown>)).toEqual([]);
  });

  it("leerRutasReferenciadas incluye las rutas de fotos_servicio junto con las de los pagos", async () => {
    const filas = new Map<unknown, { ruta: string | null }[]>([
      [pagos, [{ ruta: "comprobantes/u1/a.webp" }]],
      [fotosServicio, [{ ruta: "fotos/r1/uno.webp" }, { ruta: "fotos/r1/dos.jpg" }]],
    ]);
    const base = { select: () => ({ from: async (tabla: unknown) => filas.get(tabla) ?? [] }) };
    const rutas = await leerRutasReferenciadas(base as never);
    expect([...rutas].sort()).toEqual(["comprobantes/u1/a.webp", "fotos/r1/dos.jpg", "fotos/r1/uno.webp"]);
  });

  it("la tabla pide ruta única, reserva y usuario obligatorios", () => {
    expect(fotosServicio.ruta.notNull).toBe(true);
    expect(fotosServicio.reservaId.notNull).toBe(true);
    expect(fotosServicio.subidaPor.notNull).toBe(true);
    expect(fotosServicio.ruta.isUnique).toBe(true);
  });
});
