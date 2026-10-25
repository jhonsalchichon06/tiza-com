import { describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../errores";
import { insertarEnPrimerEquipoLibre, MENSAJE_SIN_CUPO, moverAlPrimerEquipoLibre, type FilaReserva } from "./asignar";
import type { Transaccion } from "./expirar";

vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const FILA = { usuarioId: "u1", tipo: "estandar" } as unknown as FilaReserva;

// Transacción doble: cada intento es un "savepoint" que puede fallar según el equipo.
function transaccionDoble(resultados: Record<number, "ok" | Error>) {
  const intentos: number[] = [];
  let savepointsAbiertos = 0;
  const tx = {
    transaction: async (cb: (sp: unknown) => Promise<unknown>) => {
      savepointsAbiertos++;
      const sp = {
        insert: () => ({
          values: (valores: { equipoId: number }) => ({
            returning: async () => {
              intentos.push(valores.equipoId);
              const r = resultados[valores.equipoId];
              if (r instanceof Error) throw r;
              return [{ id: `reserva-${valores.equipoId}`, equipoId: valores.equipoId }];
            },
          }),
        }),
      };
      return cb(sp);
    },
  } as unknown as Pick<Transaccion, "transaction">;
  return { tx, intentos, abiertos: () => savepointsAbiertos };
}

const choque = () => Object.assign(new Error("Failed query"), { cause: { code: "23P01" } });

describe("insertarEnPrimerEquipoLibre", () => {
  it("asigna al primer equipo si está libre", async () => {
    const { tx, intentos } = transaccionDoble({ 1: "ok", 2: "ok" });
    const r = await insertarEnPrimerEquipoLibre(tx, [1, 2], FILA);
    expect(r).toMatchObject({ equipoId: 1 });
    expect(intentos).toEqual([1]);
  });

  it("usa el segundo si el primero choca, y la transacción sigue usable", async () => {
    const { tx, intentos, abiertos } = transaccionDoble({ 1: choque(), 2: "ok" });
    const r = await insertarEnPrimerEquipoLibre(tx, [1, 2], FILA);
    expect(r).toMatchObject({ equipoId: 2 });
    expect(intentos).toEqual([1, 2]);
    expect(abiertos()).toBe(2); // un savepoint por intento
  });

  it("responde 409 con el mensaje cuando todos los equipos chocan", async () => {
    const { tx } = transaccionDoble({ 1: choque(), 2: choque() });
    const error = await insertarEnPrimerEquipoLibre(tx, [1, 2], FILA).catch((e) => e as ErrorApi);
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error).toMatchObject({ status: 409, message: MENSAJE_SIN_CUPO });
    expect(MENSAJE_SIN_CUPO).toBe("Esa hora ya no está disponible. Elige otra hora.");
  });

  it("propaga un error distinto sin probar otro equipo", async () => {
    const check = Object.assign(new Error("Failed query"), { cause: { code: "23514" } });
    const { tx, intentos } = transaccionDoble({ 1: check, 2: "ok" });
    await expect(insertarEnPrimerEquipoLibre(tx, [1, 2], FILA)).rejects.toBe(check);
    expect(intentos).toEqual([1]);
  });

  it("una lista vacía de equipos da 409", async () => {
    const { tx } = transaccionDoble({});
    await expect(insertarEnPrimerEquipoLibre(tx, [], FILA)).rejects.toMatchObject({ status: 409 });
  });

  it("también reconoce el 23P01 sin envoltorio", async () => {
    const { tx } = transaccionDoble({ 1: Object.assign(new Error("x"), { code: "23P01" }), 2: "ok" });
    expect(await insertarEnPrimerEquipoLibre(tx, [1, 2], FILA)).toMatchObject({ equipoId: 2 });
  });
});

// --- moverAlPrimerEquipoLibre (reprogramar): UPDATE de la misma fila, un savepoint por equipo ---
describe("moverAlPrimerEquipoLibre", () => {
  const CAMBIOS = { inicio: new Date("2026-12-01T15:00:00Z"), fin: new Date("2026-12-01T19:00:00Z"), finBloqueo: new Date("2026-12-01T20:00:00Z") };

  function movimientoDoble(resultados: Record<number, "ok" | Error>) {
    const intentos: { equipoId: number; set: Record<string, unknown> }[] = [];
    let inserts = 0;
    let savepoints = 0;
    const tx = {
      transaction: async (cb: (sp: unknown) => Promise<unknown>) => {
        savepoints++;
        const sp = {
          insert: () => {
            inserts++;
            throw new Error("mover no inserta");
          },
          update: () => ({
            set: (set: { equipoId: number }) => ({
              where: () => ({
                returning: async () => {
                  intentos.push({ equipoId: set.equipoId, set });
                  const r = resultados[set.equipoId];
                  if (r instanceof Error) throw r;
                  return [{ id: "reserva-1", equipoId: set.equipoId }];
                },
              }),
            }),
          }),
        };
        return cb(sp);
      },
    } as unknown as Pick<Transaccion, "transaction">;
    return { tx, intentos, inserts: () => inserts, savepoints: () => savepoints };
  }

  it("acepta en el primer equipo y actualiza el horario sin tocar el resto", async () => {
    const { tx, intentos } = movimientoDoble({ 1: "ok", 2: "ok" });
    const r = await moverAlPrimerEquipoLibre(tx, "reserva-1", [1, 2], CAMBIOS);
    expect(r).toMatchObject({ equipoId: 1 });
    expect(intentos.map((i) => i.equipoId)).toEqual([1]);
    expect(Object.keys(intentos[0].set).sort()).toEqual(["actualizadaEn", "apoyoEstado", "equipoId", "fin", "finBloqueo", "inicio"]);
    expect(intentos[0].set).toMatchObject({ inicio: CAMBIOS.inicio, fin: CAMBIOS.fin, finBloqueo: CAMBIOS.finBloqueo, apoyoEstado: undefined });
  });

  it("salta al siguiente equipo tras un 23P01, con un savepoint por intento", async () => {
    const { tx, intentos, savepoints } = movimientoDoble({ 1: choque(), 2: "ok" });
    expect(await moverAlPrimerEquipoLibre(tx, "reserva-1", [1, 2], CAMBIOS)).toMatchObject({ equipoId: 2 });
    expect(intentos.map((i) => i.equipoId)).toEqual([1, 2]);
    expect(savepoints()).toBe(2);
  });

  it("propaga cualquier otro error sin probar otro equipo", async () => {
    const check = Object.assign(new Error("Failed query"), { cause: { code: "23514" } });
    const { tx, intentos } = movimientoDoble({ 1: check, 2: "ok" });
    await expect(moverAlPrimerEquipoLibre(tx, "reserva-1", [1, 2], CAMBIOS)).rejects.toBe(check);
    expect(intentos.map((i) => i.equipoId)).toEqual([1]);
  });

  it("409 sin cupo cuando todos los equipos chocan", async () => {
    const { tx } = movimientoDoble({ 1: choque(), 2: choque() });
    const error = await moverAlPrimerEquipoLibre(tx, "reserva-1", [1, 2], CAMBIOS).catch((e) => e as ErrorApi);
    expect(error).toMatchObject({ status: 409, message: MENSAJE_SIN_CUPO });
  });

  it("no hace insert", async () => {
    const { tx, inserts } = movimientoDoble({ 1: "ok" });
    await moverAlPrimerEquipoLibre(tx, "reserva-1", [1], CAMBIOS);
    expect(inserts()).toBe(0);
  });

  it("fija el estado del apoyo cuando se pide", async () => {
    const { tx, intentos } = movimientoDoble({ 1: "ok" });
    await moverAlPrimerEquipoLibre(tx, "reserva-1", [1], { ...CAMBIOS, apoyoEstado: "por_coordinar" });
    expect(intentos[0].set.apoyoEstado).toBe("por_coordinar");
  });
});
