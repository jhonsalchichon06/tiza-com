import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { agruparPorAmbiente, listarFotosDeReserva, type FotoVista } from "./listar";

// Doble de `select().from().where().orderBy()` que registra el SQL y devuelve las filas dadas.
function baseCon(filas: unknown[]) {
  const visto: { donde?: { sql: string; params: unknown[] }; orden?: string[]; columnas?: string[] } = {};
  const dialecto = new PgDialect();
  const base = {
    select: (columnas: Record<string, unknown>) => {
      visto.columnas = Object.keys(columnas);
      const c = {
        from: () => c,
        where: (d: Parameters<PgDialect["sqlToQuery"]>[0]) => {
          visto.donde = dialecto.sqlToQuery(d);
          return c;
        },
        orderBy: (...o: Parameters<PgDialect["sqlToQuery"]>[0][]) => {
          visto.orden = o.map((x) => dialecto.sqlToQuery(x).sql);
          return Promise.resolve(filas);
        },
      };
      return c;
    },
  };
  return { base: base as never, visto };
}

describe("listarFotosDeReserva", () => {
  it("filtra por la reserva, ordena por creada_en y trae la etiqueta", async () => {
    const { base, visto } = baseCon([
      { id: "f1", ambiente: "cocina" },
      { id: "f2", ambiente: "bano" },
    ]);
    const fotos = await listarFotosDeReserva(base, "r1");
    expect(fotos).toEqual([
      { id: "f1", ambiente: "cocina", etiqueta: "Cocina" },
      { id: "f2", ambiente: "bano", etiqueta: "Baño" },
    ]);
    expect(visto.donde?.sql).toContain('"reserva_id" = $1');
    expect(visto.donde?.params).toEqual(["r1"]);
    expect(visto.orden?.[0]).toContain('"creada_en"');
  });

  it("no pide ni devuelve la ruta del archivo", async () => {
    const { base, visto } = baseCon([{ id: "f1", ambiente: "sala", ruta: "fotos/r1/x.webp" }]);
    const fotos = await listarFotosDeReserva(base, "r1");
    expect(visto.columnas).toEqual(["id", "ambiente"]);
    expect(JSON.stringify(fotos)).not.toContain("fotos/r1");
    expect(Object.keys(fotos[0]).sort()).toEqual(["ambiente", "etiqueta", "id"]);
  });

  it("sin fotos devuelve una lista vacía", async () => {
    const { base } = baseCon([]);
    expect(await listarFotosDeReserva(base, "r1")).toEqual([]);
  });
});

const foto = (id: string, ambiente: string): FotoVista => ({ id, ambiente, etiqueta: ambiente });

describe("agruparPorAmbiente", () => {
  it("agrupa y respeta el orden de AMBIENTES, no el de subida", () => {
    const grupos = agruparPorAmbiente([foto("1", "sala"), foto("2", "cocina"), foto("3", "sala"), foto("4", "bano")]);
    expect(grupos.map((g) => g.ambiente)).toEqual(["cocina", "bano", "sala"]);
    expect(grupos.find((g) => g.ambiente === "sala")?.fotos.map((f) => f.id)).toEqual(["1", "3"]);
    expect(grupos[1].etiqueta).toBe("Baño");
  });

  it("conserva el orden de subida dentro de un grupo", () => {
    const grupos = agruparPorAmbiente([foto("b", "cocina"), foto("a", "cocina")]);
    expect(grupos[0].fotos.map((f) => f.id)).toEqual(["b", "a"]);
  });

  it("lista vacía: sin grupos", () => expect(agruparPorAmbiente([])).toEqual([]));

  it("un ambiente desconocido cae en «otro»", () => {
    const grupos = agruparPorAmbiente([foto("1", "garaje")]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].ambiente).toBe("otro");
  });
});
