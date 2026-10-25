import { describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../errores";
import { conReintento } from "../reintento";
import { errorOriginal } from "./errores-bd";

const llamadas: string[] = [];
const cierre = vi.fn();
const expirar = vi.fn();
vi.mock("../pagos/cierre", () => ({ cerrarMembresiasSinReenvio: (...a: unknown[]) => cierre(...a) }));
vi.mock("./expirar", () => ({ expirarVencidas: (...a: unknown[]) => expirar(...a) }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe abrir la base"); } }));

import { ejecutarPasadaDeExpiracion } from "./pasada";

function crearBase(falla?: Error) {
  const estado = { transacciones: 0 };
  const tx = { id: "tx" };
  const base = {
    transaction: async <T>(fn: (t: unknown) => Promise<T>): Promise<T> => {
      estado.transacciones++;
      if (falla) throw falla;
      return fn(tx);
    },
  };
  return { base: base as never, estado, tx };
}

const config = (dias = 7) => async () => ({ reenvio_comprobante_dias: dias });

describe("ejecutarPasadaDeExpiracion", () => {
  it("abre una transacción, expira y luego cierra con el plazo de configuración; devuelve ambos ids", async () => {
    llamadas.length = 0;
    expirar.mockImplementation(async () => { llamadas.push("expirar"); return ["r1", "r2"]; });
    cierre.mockImplementation(async () => { llamadas.push("cierre"); return ["m1"]; });
    const { base, estado, tx } = crearBase();
    const r = await ejecutarPasadaDeExpiracion(base, config(5));
    expect(estado.transacciones).toBe(1);
    expect(llamadas).toEqual(["expirar", "cierre"]);
    expect(expirar).toHaveBeenCalledWith(tx);
    expect(cierre).toHaveBeenCalledWith(tx, 5);
    expect(r).toEqual({ reservas: ["r1", "r2"], membresias: ["m1"] });
  });

  it("sin vencidas devuelve listas vacías", async () => {
    expirar.mockResolvedValue([]);
    cierre.mockResolvedValue([]);
    expect(await ejecutarPasadaDeExpiracion(crearBase().base, config())).toEqual({ reservas: [], membresias: [] });
  });

  it("si la transacción falla propaga el error", async () => {
    await expect(ejecutarPasadaDeExpiracion(crearBase(new Error("boom")).base, config())).rejects.toThrow("boom");
  });

  it("si la lectura de configuración falla no abre la transacción", async () => {
    const { base, estado } = crearBase();
    await expect(ejecutarPasadaDeExpiracion(base, async () => { throw new Error("Falta el parámetro de configuración: reenvio_comprobante_dias"); })).rejects.toThrow(/reenvio_comprobante_dias/);
    expect(estado.transacciones).toBe(0);
  });

  it("un corte de conexión seguido de éxito dentro de conReintento ejecuta la pasada una vez más", async () => {
    expirar.mockResolvedValue([]);
    cierre.mockResolvedValue([]);
    const corte = Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" });
    let intento = 0;
    const base = {
      transaction: async <T>(fn: (t: unknown) => Promise<T>): Promise<T> => {
        intento++;
        if (intento === 1) throw Object.assign(new Error("Failed query"), { cause: corte });
        return fn({});
      },
    };
    const r = await conReintento(async () => {
      try {
        return await ejecutarPasadaDeExpiracion(base as never, config());
      } catch (e) {
        throw e instanceof ErrorApi ? e : errorOriginal(e);
      }
    }, 0);
    expect(intento).toBe(2);
    expect(r).toEqual({ reservas: [], membresias: [] });
  });
});
