import { describe, expect, it, vi } from "vitest";
import { esConflictoDeExclusion, errorOriginal } from "./errores-bd";
import { expirarVencidas, transaccionDeEscritura, type BaseDatos, type Transaccion } from "./expirar";

// El módulo importa el cliente real, pero `db()` es perezoso y estos dobles lo evitan: nada abre conexión.
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

describe("esConflictoDeExclusion", () => {
  it("reconoce 23P01 directo", () => {
    expect(esConflictoDeExclusion({ code: "23P01" })).toBe(true);
  });

  it("reconoce 23P01 dentro de cause (DrizzleQueryError)", () => {
    const envuelto = Object.assign(new Error("Failed query: insert into reservas"), { cause: { code: "23P01" } });
    expect(esConflictoDeExclusion(envuelto)).toBe(true);
  });

  it("no confunde otros códigos", () => {
    expect(esConflictoDeExclusion({ code: "23514" })).toBe(false);
    expect(esConflictoDeExclusion({ cause: { code: "23505" } })).toBe(false);
  });

  it.each([[null], [undefined], ["23P01"], [23], [{}]])("responde false con %j", (valor) => {
    expect(esConflictoDeExclusion(valor)).toBe(false);
  });
});

describe("errorOriginal", () => {
  it("devuelve la causa que dejó Drizzle, o el propio error si no hay", () => {
    const causa = { code: "ECONNRESET" };
    expect(errorOriginal(Object.assign(new Error("Failed query"), { cause: causa }))).toBe(causa);
    const sin = new Error("x");
    expect(errorOriginal(sin)).toBe(sin);
    expect(errorOriginal(null)).toBeNull();
  });
});

function transaccionDoble(ids: string[] = [], sentenciasCredito: unknown[][] = []) {
  const llamadas: string[] = [];
  const cola = [...sentenciasCredito];
  const consulta = {
    set: () => consulta,
    where: () => consulta,
    returning: async () => {
      llamadas.push("update");
      return ids.map((id) => ({ id }));
    },
  };
  const tx = {
    update: () => consulta,
    execute: async () => {
      llamadas.push("credito");
      return { rows: cola.shift() ?? [] };
    },
  } as unknown as Transaccion;
  const base = {
    transaction: async (cb: (t: Transaccion) => Promise<unknown>) => cb(tx),
  } as unknown as Pick<BaseDatos, "transaction">;
  return { tx, base, llamadas };
}

describe("expirarVencidas", () => {
  it("devuelve los ids de las reservas que marcó", async () => {
    const { tx } = transaccionDoble(["a", "b"]);
    expect(await expirarVencidas(tx)).toEqual(["a", "b"]);
  });

  it("no devuelve nada si no hay vencidas", async () => {
    const { tx } = transaccionDoble([]);
    expect(await expirarVencidas(tx)).toEqual([]);
  });
});

describe("expirarVencidas y el crédito", () => {
  it("sin vencidas no ejecuta ninguna sentencia de crédito", async () => {
    const { tx, llamadas } = transaccionDoble([]);
    await expirarVencidas(tx);
    expect(llamadas).toEqual(["update"]);
  });

  it("con vencidas devuelve las horas reservadas a su lote (bloquea y actualiza)", async () => {
    const { tx, llamadas } = transaccionDoble(["a"], [[{ id: "l1" }], [{ id: "l1", horas: "2" }]]);
    expect(await expirarVencidas(tx)).toEqual(["a"]);
    expect(llamadas).toEqual(["update", "credito", "credito"]);
  });

  it("un error al devolver propaga y deshace la transacción", async () => {
    const roto = {
      transaction: async (cb: (t: Transaccion) => Promise<unknown>) =>
        cb({ update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: "a" }] }) }) }), execute: async () => { throw new Error("fallo de crédito"); } } as unknown as Transaccion),
    } as unknown as Pick<BaseDatos, "transaction">;
    await expect(transaccionDeEscritura(async () => "no", roto)).rejects.toThrow("fallo de crédito");
  });
});

describe("transaccionDeEscritura", () => {
  it("expira las vencidas antes de ejecutar la lógica y devuelve su resultado", async () => {
    const { base, llamadas } = transaccionDoble();
    const resultado = await transaccionDeEscritura(async () => {
      llamadas.push("logica");
      return "listo";
    }, base);
    expect(resultado).toBe("listo");
    expect(llamadas).toEqual(["update", "logica"]);
  });

  it("propaga el error de la lógica", async () => {
    const { base } = transaccionDoble();
    await expect(transaccionDeEscritura(async () => { throw new Error("falló"); }, base)).rejects.toThrow("falló");
  });

  it("no ejecuta la lógica si falla la expiración", async () => {
    const logica = vi.fn();
    const base = {
      transaction: async (cb: (t: Transaccion) => Promise<unknown>) =>
        cb({ update: () => { throw new Error("sin base"); } } as unknown as Transaccion),
    } as unknown as Pick<BaseDatos, "transaction">;
    await expect(transaccionDeEscritura(logica, base)).rejects.toThrow("sin base");
    expect(logica).not.toHaveBeenCalled();
  });
});
