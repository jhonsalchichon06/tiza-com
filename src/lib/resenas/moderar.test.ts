import { describe, expect, it } from "vitest";
import type { ErrorApi } from "../errores";
import { crearBdDoble, type Guion } from "../perfil/__dobles__/bd-doble";
import { contarPendientes, decidirResena, listarPendientes, MENSAJE_RESENA_CAMBIO, MENSAJE_RESENA_NO_ENCONTRADA, revisionDe } from "./moderar";

const ID = "44444444-4444-4444-8444-444444444444";
const ADMIN = "admin-1";
const ZONA = "America/Lima";

const montar = (guion: Guion) => {
  const doble = crearBdDoble(guion);
  return { doble, decidir: (decision: "aprobada" | "rechazada", id = ID, revision?: string) => decidirResena({ id, decision, adminId: ADMIN, revision }, { base: () => doble.base }) };
};

async function error(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("se esperaba un error");
}

describe("listarPendientes", () => {
  it("devuelve la cola con los datos de la limpieza, en la hora de Lima, y filtra solo por pendientes con la más antigua primero", async () => {
    const doble = crearBdDoble({
      resenas: [
        [
          { id: "r1", estrellas: 5, comentario: "Muy bien", cliente: "María Pérez", distrito: "Miraflores", inicio: new Date("2026-11-06T15:00:00Z"), creadaEn: new Date("2026-11-07T14:30:00Z") },
          { id: "r2", estrellas: 3, comentario: "Normal", cliente: "Luis Ríos", distrito: "Lince", inicio: new Date("2026-11-08T15:00:00Z"), creadaEn: new Date("2026-11-09T14:30:00Z") },
        ],
      ],
    });
    const cola = await listarPendientes(doble.base, ZONA);
    expect(cola.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(cola[0]).toEqual({
      id: "r1",
      revision: revisionDe(5, "Muy bien"),
      estrellas: 5,
      comentario: "Muy bien",
      cliente: "María Pérez",
      distrito: "Miraflores",
      inicio: "2026-11-06T10:00:00-05:00",
      creada_en: "2026-11-07T09:30:00-05:00",
    });
    const [lectura] = doble.lecturas();
    expect(lectura.donde?.params).toContain("pendiente");
    expect(lectura.limite).toBe(100);
  });

  it("sin pendientes devuelve una lista vacía", async () => {
    expect(await listarPendientes(crearBdDoble({ resenas: [[]] }).base, ZONA)).toEqual([]);
  });
});

describe("contarPendientes", () => {
  it("cuenta las pendientes", async () => {
    expect(await contarPendientes(crearBdDoble({ resenas: [[{ n: 3 }]] }).base)).toBe(3);
    expect(await contarPendientes(crearBdDoble({ resenas: [[]] }).base)).toBe(0);
  });
});

describe("decidirResena", () => {
  it.each(["aprobada", "rechazada"] as const)("%s: escribe estado, autor y fecha con el reloj de la base, bloqueando la fila", async (decision) => {
    const revisadaEn = new Date("2026-11-10T15:00:00Z");
    const m = montar({ resenas: [[{ id: ID, estado: "pendiente", estrellas: 5, comentario: "Muy bien" }], [{ id: ID, estado: decision, revisadaEn }]] });
    const r = await m.decidir(decision);
    expect(r).toEqual({ resena: { id: ID, estado: decision, revisada_en: revisadaEn.toISOString() } });
    expect(m.doble.bloqueos()).toEqual(["resenas"]);
    const [escritura] = m.doble.escrituras();
    expect(escritura.tabla).toBe("resenas");
    expect(escritura.set).toMatchObject({ estado: decision, revisadaPor: ADMIN });
    expect(Object.keys(escritura.set!).sort()).toEqual(["actualizadaEn", "estado", "revisadaEn", "revisadaPor"]);
  });

  it.each(["aprobada", "rechazada"] as const)("una ya %s da 409 (repetir o contradecir) con el estado actual y no escribe", async (actual) => {
    for (const decision of ["aprobada", "rechazada"] as const) {
      const m = montar({ resenas: [[{ id: ID, estado: actual }]] });
      const e = await error(m.decidir(decision));
      expect(e).toMatchObject({ status: 409 });
      expect(e.message).toContain(actual === "aprobada" ? "aprobada" : "rechazada");
      expect(m.doble.escrituras()).toEqual([]);
    }
  });

  it("con la huella de lo que el administrador vio, decide; si el cliente la editó entre tanto, 409 sin escribir", async () => {
    const vista = { id: ID, estado: "pendiente", estrellas: 4, comentario: "Texto que se leyó." };
    const ok = montar({ resenas: [[vista], [{ id: ID, estado: "aprobada", revisadaEn: new Date() }]] });
    await ok.decidir("aprobada", ID, revisionDe(4, "Texto que se leyó."));
    expect(ok.doble.escrituras()).toHaveLength(1);

    const editada = montar({ resenas: [[{ ...vista, comentario: "Texto nuevo del cliente." }]] });
    expect(await error(editada.decidir("aprobada", ID, revisionDe(4, "Texto que se leyó.")))).toMatchObject({ status: 409, message: MENSAJE_RESENA_CAMBIO });
    expect(editada.doble.escrituras()).toEqual([]);
  });

  it("una reseña inexistente da 404", async () => {
    const m = montar({ resenas: [[]] });
    expect(await error(m.decidir("aprobada"))).toMatchObject({ status: 404, message: MENSAJE_RESENA_NO_ENCONTRADA });
  });

  it("un id sin formato de uuid da 404 sin abrir la transacción", async () => {
    const m = montar({});
    expect(await error(m.decidir("aprobada", "abc"))).toMatchObject({ status: 404 });
    expect(m.doble.estado.transacciones).toBe(0);
  });
});
