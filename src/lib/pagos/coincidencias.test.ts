import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { normalizarNumero, normalizarTexto } from "../direccion";
import { buscarCoincidencias, callesParecidas, callePorNumero, clasificarCoincidencia, numeroDe, type DireccionComparable } from "./coincidencias";

// Construye la dirección normalizada como lo hace el servidor al guardar la reserva.
const dir = (calle: string, numero: string, departamento = "", distrito = "Miraflores"): DireccionComparable => ({
  distrito,
  direccionNormalizada: `${normalizarTexto(calle)} ${normalizarNumero(numero)}`,
  departamentoNormalizado: departamento ? normalizarTexto(departamento) : "",
});

describe("numeroDe y callePorNumero", () => {
  it.each([
    ["avenida larco 123", "123", "avenida larco"],
    ["avenida larco 123a", "123", "avenida larco"],
    ["larco 45", "45", "larco"],
  ])("%s", (d, numero, calle) => {
    expect(numeroDe(d)).toBe(numero);
    expect(callePorNumero(d)).toBe(calle);
  });
  it("sin dígitos devuelve null", () => expect(numeroDe("larco")).toBeNull());
});

describe("callesParecidas", () => {
  it.each([
    ["Av. Larco", "Jr. Larco", true],
    ["Av. Larco", "Larco", true],
    ["Javier Prado Este", "Javier Prado", true],
    ["Los Pinos", "Los Pino", true],
    ["Larco", "Arequipa", false],
    ["Av. Arequipa", "Av. Larco", false],
    ["Calle Los Pinos", "Pinos", true],
    ["Av. Alfredo Benavides", "Av. Alfredo Benavidez", true], // 1 letra en una calle larga
    ["Av. Alfredo Benavides", "Av. Alfredo Benavidzz", true], // 2 letras en una calle larga
    ["Av. Alfredo Benavides", "Av. Alfredo Bnvdz", false], // 4 letras
    ["Pardo", "Pardi", true], // 1 letra en una calle corta
    ["Pardo", "Pardxy", false], // 2 letras en una calle corta
  ])("%s vs %s → %s", (a, b, esperado) => {
    expect(callesParecidas(normalizarTexto(a), normalizarTexto(b))).toBe(esperado);
  });
});

describe("clasificarCoincidencia", () => {
  const revisada = dir("Av. Larco", "123", "Dpto. 302");

  it("misma dirección y mismo departamento → misma_direccion", () => {
    expect(clasificarCoincidencia(revisada, dir("Avenida Larco", "123", "dpto 302"))).toBe("misma_direccion");
  });
  it("misma dirección sin departamento en ambas → misma_direccion", () => {
    expect(clasificarCoincidencia(dir("Av. Larco", "123"), dir("Av. Larco", "123"))).toBe("misma_direccion");
  });
  it("misma dirección y otro departamento → otro_departamento", () => {
    expect(clasificarCoincidencia(revisada, dir("Av. Larco", "123", "Dpto. 402"))).toBe("otro_departamento");
  });
  it("«Larco 123» contra «Av. Larco 123» → calle_parecida", () => {
    expect(clasificarCoincidencia(dir("Larco", "123"), dir("Av. Larco", "123"))).toBe("calle_parecida");
  });
  it("«Av. Larco 123» contra «Jr. Larco 123» → calle_parecida", () => {
    expect(clasificarCoincidencia(dir("Av. Larco", "123"), dir("Jr. Larco", "123"))).toBe("calle_parecida");
  });
  it("el número 123 y 123-A son el mismo número", () => {
    expect(clasificarCoincidencia(dir("Av. Larco", "123"), dir("Av. Larco", "123-A"))).toBe("calle_parecida");
  });
  it("otro número (124) → null", () => {
    expect(clasificarCoincidencia(revisada, dir("Av. Larco", "124"))).toBeNull();
  });
  it("calle distinta → null", () => {
    expect(clasificarCoincidencia(revisada, dir("Av. Arequipa", "123"))).toBeNull();
  });
  it("otro distrito → null", () => {
    expect(clasificarCoincidencia(revisada, dir("Av. Larco", "123", "Dpto. 302", "San Isidro"))).toBeNull();
  });
});

// --- buscarCoincidencias con un doble de la base ---

type FilaRevisada = { usuarioId: string; distrito: string; direccionNormalizada: string; departamentoNormalizado: string };
function crearBase(revisada: FilaRevisada | null, candidatas: Record<string, unknown>[]) {
  const consultas: string[] = [];
  const donde: { sql: string; params: unknown[] }[] = [];
  const cadena = (filas: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "orderBy"]) c[m] = () => c;
    c.where = (d: unknown) => {
      donde.push(new PgDialect().sqlToQuery(d as Parameters<PgDialect["sqlToQuery"]>[0]));
      return c;
    };
    c.limit = async () => filas;
    c.then = (resolver: (v: unknown) => unknown, rechazar: (e: unknown) => unknown) => Promise.resolve(filas).then(resolver, rechazar);
    return c;
  };
  let n = 0;
  const base = {
    select: () => {
      consultas.push(n === 0 ? "revisada" : "candidatas");
      return n++ === 0 ? cadena(revisada ? [revisada] : []) : cadena(candidatas);
    },
  };
  return { base: base as never, consultas, donde };
}

const REVISADA: FilaRevisada = { usuarioId: "u1", distrito: "Miraflores", direccionNormalizada: "avenida larco 123", departamentoNormalizado: "dpto 302" };
const cand = (calle: string, numero: string, departamento: string | null, extra: Record<string, unknown> = {}) => ({
  cliente: "Otra Persona",
  distrito: "Miraflores",
  calle,
  numero,
  departamento,
  direccionNormalizada: `${normalizarTexto(calle)} ${normalizarNumero(numero)}`,
  departamentoNormalizado: departamento ? normalizarTexto(departamento) : "",
  estado: "confirmada",
  inicio: new Date("2099-01-05T15:00:00Z"),
  ...extra,
});

describe("buscarCoincidencias", () => {
  it("sin reserva gratis → aplica: false y no consulta candidatas", async () => {
    const { base, consultas } = crearBase(null, []);
    expect(await buscarCoincidencias(base, "m1")).toEqual({ aplica: false, coincidencias: [] });
    expect(consultas).toEqual(["revisada"]);
  });

  it("sin membresía → aplica: false sin consultar", async () => {
    const { base, consultas } = crearBase(REVISADA, []);
    expect(await buscarCoincidencias(base, null)).toEqual({ aplica: false, coincidencias: [] });
    expect(consultas).toEqual([]);
  });

  it("con reserva gratis pero sin candidatas → aplica: true y lista vacía", async () => {
    const { base } = crearBase(REVISADA, []);
    expect(await buscarCoincidencias(base, "m1")).toEqual({ aplica: true, coincidencias: [] });
  });

  it("clasifica, descarta lo que no se parece y ordena de la más cercana a la menos cercana", async () => {
    const { base } = crearBase(REVISADA, [
      cand("Jr. Larco", "123", "Dpto. 999"), // calle parecida
      cand("Av. Arequipa", "123", null), // no
      cand("Av. Larco", "123", "Dpto. 402"), // otro departamento
      cand("Av. Larco", "123", "Dpto. 302", { estado: "completada" }), // misma dirección
      cand("Av. Larco", "124", null), // otro número
    ]);
    const r = await buscarCoincidencias(base, "m1");
    expect(r.aplica).toBe(true);
    expect(r.coincidencias.map((c) => c.nivel)).toEqual(["misma_direccion", "otro_departamento", "calle_parecida"]);
    expect(r.coincidencias[0]).toMatchObject({ cliente: "Otra Persona", distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: "Dpto. 302", estado: "completada" });
  });
  it("la consulta de candidatas usa reservaActiva, completada, el mismo distrito y excluye al mismo cliente", async () => {
    const { base, donde } = crearBase(REVISADA, []);
    await buscarCoincidencias(base, "m1");
    const q = donde[1];
    expect(q.sql).toContain('"reservas"."primera_gratis"');
    expect(q.sql).toContain("now()"); // pendiente vigente, no vencida
    expect(q.sql).toContain('"reservas"."usuario_id" <> $');
    expect(q.params).toEqual(expect.arrayContaining(["confirmada", "pendiente", "completada", "Miraflores", "u1"]));
    expect(q.params).not.toContain("cancelada");
    expect(q.params).not.toContain("expirada");
  });

  it("la reserva expirada del reenvío conserva su contexto: se busca por membresía y no por pago", async () => {
    const { base } = crearBase(REVISADA, [cand("Larco", "123", null)]);
    expect((await buscarCoincidencias(base, "m-del-reenvio")).coincidencias).toHaveLength(1);
  });
});
