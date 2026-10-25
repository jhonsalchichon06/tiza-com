import { describe, expect, it } from "vitest";
import type { ErrorApi } from "../errores";
import { crearBdDoble, type Guion } from "../perfil/__dobles__/bd-doble";
import { crearResena, MENSAJE_YA_RESENADA, MENSAJES_NO_RESENABLE } from "./crear";

const RESERVA = "33333333-3333-4333-8333-333333333333";
const CLIENTE = "cliente-a";
const cuerpo = { estrellas: 5, comentario: "Dejaron todo muy limpio, gracias." };
const creada = { id: "rrrrrrrr-0000-4000-8000-000000000000", estrellas: 5, comentario: cuerpo.comentario, estado: "pendiente" };

const montar = (guion: Guion, opciones?: Parameters<typeof crearBdDoble>[1]) => {
  const doble = crearBdDoble(guion, opciones);
  return { doble, crear: (id = RESERVA, c: unknown = cuerpo) => crearResena({ usuarioId: CLIENTE, reservaId: id, cuerpo: c }, { base: () => doble.base }) };
};

async function error(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("se esperaba un error");
}

describe("crearResena", () => {
  it("crea la reseña pendiente de una reserva completada, con la reserva bloqueada y el dueño en el WHERE", async () => {
    const m = montar({ reservas: [[{ id: RESERVA, estado: "completada" }]], resenas: [[creada]] });
    expect(await m.crear()).toEqual(creada);
    expect(m.doble.bloqueos()).toEqual(["reservas"]);
    const lectura = m.doble.lecturas()[0];
    expect(lectura.donde?.params).toEqual(expect.arrayContaining([RESERVA, CLIENTE]));
    const [insercion] = m.doble.escrituras();
    expect(insercion).toMatchObject({ tipo: "insert", tabla: "resenas" });
    expect(insercion.valores).toEqual({ reservaId: RESERVA, estrellas: 5, comentario: cuerpo.comentario });
  });

  it.each(["confirmada", "pendiente", "cancelada", "expirada"] as const)("una reserva %s da 409 con su mensaje y no inserta", async (estado) => {
    const m = montar({ reservas: [[{ id: RESERVA, estado }]] });
    expect(await error(m.crear())).toMatchObject({ status: 409, message: MENSAJES_NO_RESENABLE[estado] });
    expect(m.doble.escrituras()).toEqual([]);
  });

  it("cada estado no reseñable tiene un mensaje distinto", () => {
    expect(new Set(Object.values(MENSAJES_NO_RESENABLE)).size).toBe(4);
  });

  it("una segunda reseña (23505) da 409", async () => {
    const m = montar({ reservas: [[{ id: RESERVA, estado: "completada" }]], resenas: [() => Promise.reject(Object.assign(new Error("duplicada"), { code: "23505" }))] });
    expect(await error(m.crear())).toMatchObject({ status: 409, message: MENSAJE_YA_RESENADA });
  });

  it("el 23505 dentro de cause (como lo deja Drizzle) también da 409", async () => {
    const envuelto = Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("duplicada"), { code: "23505" }) });
    const m = montar({ reservas: [[{ id: RESERVA, estado: "completada" }]], resenas: [() => Promise.reject(envuelto)] });
    expect(await error(m.crear())).toMatchObject({ status: 409, message: MENSAJE_YA_RESENADA });
  });

  it("otro error de la base no se traduce", async () => {
    const m = montar({ reservas: [[{ id: RESERVA, estado: "completada" }]], resenas: [() => Promise.reject(Object.assign(new Error("otra cosa"), { code: "23514" }))] });
    expect(await error(m.crear())).toMatchObject({ message: "otra cosa" });
  });

  it("una reserva ajena o inexistente da 404 y no escribe", async () => {
    const m = montar({ reservas: [[]] });
    expect(await error(m.crear())).toMatchObject({ status: 404 });
    expect(m.doble.escrituras()).toEqual([]);
  });

  it("un id sin formato de uuid da 404 sin abrir la transacción", async () => {
    const m = montar({});
    expect(await error(m.crear("abc"))).toMatchObject({ status: 404 });
    expect(m.doble.estado.transacciones).toBe(0);
  });

  it("estrellas o comentario inválidos dan 422 sin abrir la transacción", async () => {
    const m = montar({});
    expect(await error(m.crear(RESERVA, { estrellas: 0, comentario: cuerpo.comentario }))).toMatchObject({ status: 422 });
    expect(await error(m.crear(RESERVA, { estrellas: 5, comentario: "corto" }))).toMatchObject({ status: 422 });
    expect(m.doble.estado.transacciones).toBe(0);
  });

  it("no puede fijar estado ni revisión: solo escribe reserva, estrellas y comentario", async () => {
    const m = montar({ reservas: [[{ id: RESERVA, estado: "completada" }]], resenas: [[creada]] });
    await m.crear(RESERVA, { ...cuerpo, estado: "aprobada", revisadaPor: "admin" });
    expect(Object.keys(m.doble.escrituras()[0].valores as object).sort()).toEqual(["comentario", "estrellas", "reservaId"]);
  });
});
