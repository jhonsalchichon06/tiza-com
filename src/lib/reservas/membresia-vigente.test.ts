import { describe, expect, it } from "vitest";
import { crearLectorDoble } from "./__dobles__/lector-doble";
import { leerMembresiaQueAutoriza, tieneMembresiaActiva } from "./membresia-vigente";

const inicio = new Date("2026-10-01T15:00:00Z");
const fila = (cambios: Record<string, unknown>) => ({ id: "m", usuarioId: "u1", estado: "activa", inicio, fin: new Date("2027-01-01T15:00:00Z"), vigente: true, ...cambios });

describe("leerMembresiaQueAutoriza", () => {
  it("sin membresías devuelve null", async () => {
    const { lector } = crearLectorDoble([]);
    expect(await leerMembresiaQueAutoriza(lector, "u1")).toBeNull();
  });

  it("solo una pendiente: null", async () => {
    const { lector } = crearLectorDoble([fila({ estado: "pendiente", inicio: null, fin: null })]);
    expect(await leerMembresiaQueAutoriza(lector, "u1")).toBeNull();
  });

  it("una activa vigente", async () => {
    const { lector } = crearLectorDoble([fila({ id: "m1" })]);
    expect(await leerMembresiaQueAutoriza(lector, "u1")).toMatchObject({ id: "m1", vigente: true, fin: new Date("2027-01-01T15:00:00Z") });
  });

  it("una activa vencida: vigente falso", async () => {
    const { lector } = crearLectorDoble([fila({ id: "m1", vigente: false, fin: new Date("2026-10-10T15:00:00Z") })]);
    expect(await leerMembresiaQueAutoriza(lector, "u1")).toMatchObject({ id: "m1", vigente: false });
  });

  it("con dos activas gana la de fin más lejano", async () => {
    const { lector, consultas } = crearLectorDoble([
      fila({ id: "corta", fin: new Date("2026-12-01T15:00:00Z") }),
      fila({ id: "larga", fin: new Date("2027-03-01T15:00:00Z") }),
    ]);
    expect((await leerMembresiaQueAutoriza(lector, "u1"))?.id).toBe("larga");
  });

  it("las caducadas y las de otro cliente no cuentan, y el filtro lleva el usuario", async () => {
    const { lector, consultas } = crearLectorDoble([fila({ id: "c", estado: "caducada" }), fila({ id: "otro", usuarioId: "u2" })]);
    expect(await leerMembresiaQueAutoriza(lector, "u1")).toBeNull();
    expect(consultas[0].params).toContain("u1");
    expect(consultas[0].params).toContain("activa");
    expect(consultas[0].sql).toContain("usuario_id");
  });
});

describe("tieneMembresiaActiva", () => {
  it("cualquier activa cuenta, vigente o vencida", async () => {
    expect(await tieneMembresiaActiva(crearLectorDoble([fila({ vigente: false })]).lector, "u1")).toBe(true);
    expect(await tieneMembresiaActiva(crearLectorDoble([fila({})]).lector, "u1")).toBe(true);
  });

  it("pendiente, caducada o de otro cliente no cuentan", async () => {
    expect(await tieneMembresiaActiva(crearLectorDoble([fila({ estado: "pendiente" }), fila({ estado: "caducada" }), fila({ usuarioId: "u2" })]).lector, "u1")).toBe(false);
  });
});
