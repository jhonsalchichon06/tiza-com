import { describe, expect, it, vi } from "vitest";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import * as esquemaReal from "@/db/esquema";
import { columnasDeRutaSinDeclarar, COLUMNAS_CON_IMAGEN, leerRutasReferenciadas, type ColumnaConImagen } from "./referencias";
import type { AlmacenDeImagenes, ElementoListado, PaginaListada } from "./almacen";
import { limpiarHuerfanos } from "./huerfanos";

vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const AHORA = new Date("2026-11-10T12:00:00Z");
const hace = (horas: number) => new Date(AHORA.getTime() - horas * 3_600_000);
const el = (ruta: string, horas: number): ElementoListado => ({ ruta, subidoEn: hace(horas), tamano: 1000 });

// Almacén doble paginado: cada prefijo tiene una lista de páginas.
function almacen(paginas: Record<string, ElementoListado[][]>, falla: string[] = []) {
  const borrados: string[] = [];
  const listar = vi.fn(async ({ prefijo, cursor }: { prefijo: string; cursor?: string }): Promise<PaginaListada> => {
    const lista = paginas[prefijo] ?? [];
    const i = cursor ? Number(cursor) : 0;
    return { elementos: lista[i] ?? [], cursor: i + 1 < lista.length ? String(i + 1) : undefined, hayMas: i + 1 < lista.length };
  });
  const borrar = vi.fn(async (ruta: string) => {
    if (falla.includes(ruta)) throw new Error("Blob falló");
    borrados.push(ruta);
  });
  return { almacen: { listar, borrar } as Pick<AlmacenDeImagenes, "listar" | "borrar">, borrados, listar, borrar };
}

const limpiar = (a: ReturnType<typeof almacen>, referenciadas: string[] = [], columnas = 1) =>
  limpiarHuerfanos({ almacen: a.almacen, leerReferencias: async () => new Set(referenciadas), columnasDeclaradas: columnas, ahora: AHORA });

describe("limpiarHuerfanos", () => {
  it("borra un huérfano de 30 horas y no uno de 2 horas", async () => {
    const a = almacen({ "comprobantes/": [[el("comprobantes/u1/viejo.webp", 30), el("comprobantes/u1/nuevo.webp", 2)]] });
    expect(await limpiar(a)).toEqual({ omitido: false, revisados: 2, borrados: 1, fallidos: 0 });
    expect(a.borrados).toEqual(["comprobantes/u1/viejo.webp"]);
  });

  it("no borra uno referenciado de 30 días", async () => {
    const a = almacen({ "comprobantes/": [[el("comprobantes/u1/en-uso.webp", 30 * 24)]] });
    expect((await limpiar(a, ["comprobantes/u1/en-uso.webp"])).borrados).toBe(0);
    expect(a.borrar).not.toHaveBeenCalled();
  });

  it("justo con 24 horas todavía no se borra, y con 24 horas y un minuto sí", async () => {
    const a = almacen({ "comprobantes/": [[el("comprobantes/u1/limite.webp", 24)]] });
    expect((await limpiar(a)).borrados).toBe(0);
    const b = almacen({ "comprobantes/": [[{ ruta: "comprobantes/u1/pasado.webp", subidoEn: new Date(hace(24).getTime() - 60_000), tamano: 1 }]] });
    expect((await limpiar(b)).borrados).toBe(1);
  });

  it("recorre varias páginas y las dos carpetas", async () => {
    const a = almacen({
      "comprobantes/": [[el("comprobantes/a/1.webp", 40)], [el("comprobantes/a/2.webp", 40)], [el("comprobantes/a/3.webp", 40)]],
      "fotos/": [[el("fotos/r1/1.jpg", 40)]],
    });
    const r = await limpiar(a);
    expect(r).toMatchObject({ revisados: 4, borrados: 4 });
    expect(a.listar).toHaveBeenCalledTimes(4);
  });

  it("con el registro vacío no lista ni borra nada y lo indica", async () => {
    const a = almacen({ "comprobantes/": [[el("comprobantes/u1/viejo.webp", 99)]] });
    expect(await limpiar(a, [], 0)).toEqual({ omitido: true, revisados: 0, borrados: 0, fallidos: 0 });
    expect(a.listar).not.toHaveBeenCalled();
    expect(a.borrar).not.toHaveBeenCalled();
  });

  it("si falla la lectura de referencias aborta sin borrar nada", async () => {
    const a = almacen({ "comprobantes/": [[el("comprobantes/u1/viejo.webp", 99)]] });
    await expect(
      limpiarHuerfanos({ almacen: a.almacen, leerReferencias: async () => { throw new Error("base caída"); }, columnasDeclaradas: 1, ahora: AHORA }),
    ).rejects.toThrow("base caída");
    expect(a.borrar).not.toHaveBeenCalled();
  });

  it("si falla un borrado entre varios, continúa y cuenta el fallo", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = almacen(
      { "comprobantes/": [[el("comprobantes/a/1.webp", 40), el("comprobantes/a/2.webp", 40), el("comprobantes/a/3.webp", 40)]] },
      ["comprobantes/a/2.webp"],
    );
    expect(await limpiar(a)).toMatchObject({ borrados: 2, fallidos: 1, revisados: 3 });
    expect(a.borrados).toEqual(["comprobantes/a/1.webp", "comprobantes/a/3.webp"]);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("registro de columnas con imagen", () => {
  it("declara pagos.comprobante_ruta y fotos_servicio.ruta, y el esquema real no tiene otras columnas de ruta de imagen sin declarar", () => {
    expect(COLUMNAS_CON_IMAGEN).toEqual([
      { tabla: esquemaReal.pagos, columna: esquemaReal.pagos.comprobanteRuta },
      { tabla: esquemaReal.fotosServicio, columna: esquemaReal.fotosServicio.ruta },
    ]);
    expect(columnasDeRutaSinDeclarar(esquemaReal as Record<string, unknown>)).toEqual([]);
  });

  it("con el esquema real, un archivo referenciado por un pago no se borra y uno sin referencia de más de 24 h sí", async () => {
    const filasPorTabla = new Map<unknown, { ruta: string | null }[]>([
      [esquemaReal.pagos, [{ ruta: "comprobantes/u1/de-un-pago.webp" }, { ruta: null }]],
    ]);
    const base = { select: () => ({ from: async (tabla: unknown) => filasPorTabla.get(tabla) ?? [] }) };
    const a = almacen({ "comprobantes/": [[el("comprobantes/u1/de-un-pago.webp", 30 * 24), el("comprobantes/u1/abandonado.webp", 30), el("comprobantes/u1/reciente.webp", 2)]] });
    const r = await limpiarHuerfanos({
      almacen: a.almacen,
      leerReferencias: () => leerRutasReferenciadas(base as never),
      columnasDeclaradas: COLUMNAS_CON_IMAGEN.length,
      ahora: AHORA,
    });
    expect(r).toEqual({ omitido: false, revisados: 3, borrados: 1, fallidos: 0 });
    expect(a.borrados).toEqual(["comprobantes/u1/abandonado.webp"]);
  });

  it("detecta una columna de ruta que nadie declaró", () => {
    const pagos = pgTable("pagos", { id: uuid("id").primaryKey(), comprobanteRuta: text("comprobante_ruta") });
    const fotos = pgTable("fotos_servicio", { id: uuid("id").primaryKey(), ruta: text("ruta") });
    const sinDeclarar = columnasDeRutaSinDeclarar({ pagos, fotos });
    expect(sinDeclarar).toHaveLength(2);
    expect(sinDeclarar.join(" ")).toMatch(/comprobante_ruta/);
  });

  it("una columna declarada deja de reportarse", () => {
    const pagos = pgTable("pagos", { id: uuid("id").primaryKey(), comprobanteRuta: text("comprobante_ruta") });
    const registro: ColumnaConImagen[] = [{ tabla: pagos, columna: pagos.comprobanteRuta }];
    expect(columnasDeRutaSinDeclarar({ pagos }, registro)).toEqual([]);
  });

  it("ignora columnas que no son rutas", () => {
    const t = pgTable("otra", { id: uuid("id").primaryKey(), rutina: text("rutina"), ruteo: text("ruteo") });
    expect(columnasDeRutaSinDeclarar({ t })).toEqual([]);
  });
});
