import { describe, expect, it } from "vitest";
import type { ErrorApi } from "../errores";
import { crearBdDoble, type Guion } from "../perfil/__dobles__/bd-doble";
import { editarResena, MENSAJE_SIN_RESENA, MENSAJE_YA_PUBLICADA } from "./editar";

const RESERVA = "33333333-3333-4333-8333-333333333333";
const RESENA = "44444444-4444-4444-8444-444444444444";
const CLIENTE = "cliente-a";
const cuerpo = { estrellas: 4, comentario: "Corregí mi comentario: todo estuvo bien." };
const editada = { id: RESENA, estrellas: 4, comentario: cuerpo.comentario, estado: "pendiente" };

const montar = (guion: Guion) => {
  const doble = crearBdDoble(guion);
  return { doble, editar: (id = RESERVA, c: unknown = cuerpo) => editarResena({ usuarioId: CLIENTE, reservaId: id, cuerpo: c }, { base: () => doble.base }) };
};

async function error(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("se esperaba un error");
}

describe("editarResena", () => {
  it.each(["pendiente", "rechazada"])("editar una %s la deja pendiente y sin datos de revisión", async (estado) => {
    const m = montar({ reservas: [[{ id: RESERVA }]], resenas: [[{ id: RESENA, estado }], [editada]] });
    expect(await m.editar()).toEqual(editada);
    expect(m.doble.bloqueos()).toEqual(["reservas", "resenas"]);
    const [escritura] = m.doble.escrituras();
    expect(escritura).toMatchObject({ tipo: "update", tabla: "resenas" });
    expect(escritura.set).toMatchObject({ estrellas: 4, comentario: cuerpo.comentario, estado: "pendiente", revisadaPor: null, revisadaEn: null });
    expect(Object.keys(escritura.set!)).toContain("actualizadaEn");
    // El UPDATE exige que no esté aprobada en la misma sentencia.
    expect(escritura.donde?.sql).toMatch(/<>/);
    expect(escritura.donde?.params).toContain("aprobada");
  });

  it("editar una aprobada da 409 y no escribe", async () => {
    const m = montar({ reservas: [[{ id: RESERVA }]], resenas: [[{ id: RESENA, estado: "aprobada" }]] });
    expect(await error(m.editar())).toMatchObject({ status: 409, message: MENSAJE_YA_PUBLICADA });
    expect(m.doble.escrituras()).toEqual([]);
  });

  it("si el UPDATE no afecta filas (se aprobó a la vez) da 409", async () => {
    const m = montar({ reservas: [[{ id: RESERVA }]], resenas: [[{ id: RESENA, estado: "pendiente" }], []] });
    expect(await error(m.editar())).toMatchObject({ status: 409, message: MENSAJE_YA_PUBLICADA });
  });

  it("sin reseña da 404", async () => {
    const m = montar({ reservas: [[{ id: RESERVA }]], resenas: [[]] });
    expect(await error(m.editar())).toMatchObject({ status: 404, message: MENSAJE_SIN_RESENA });
  });

  it("la reserva de otro cliente da 404 y no consulta reseñas", async () => {
    const m = montar({ reservas: [[]] });
    expect(await error(m.editar())).toMatchObject({ status: 404 });
    expect(m.doble.lecturas().map((s) => s.tabla)).toEqual(["reservas"]);
    expect(m.doble.lecturas()[0].donde?.params).toEqual(expect.arrayContaining([RESERVA, CLIENTE]));
  });

  it("id mal formado da 404 y cuerpo inválido 422, sin abrir la transacción", async () => {
    const m = montar({});
    expect(await error(m.editar("abc"))).toMatchObject({ status: 404 });
    expect(await error(m.editar(RESERVA, { estrellas: 7, comentario: cuerpo.comentario }))).toMatchObject({ status: 422 });
    expect(m.doble.estado.transacciones).toBe(0);
  });
});
