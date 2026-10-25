import { describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "../../__fixtures__/configuracion";
import { crearBdDoble } from "../../perfil/__dobles__/bd-doble";
import { consultarDisponibilidadAdmin, dependenciasDeAdmin } from "./disponibilidad";

const ID = "11111111-1111-4111-8111-111111111111";
const AHORA = new Date("2026-11-02T15:00:00Z");

describe("consultarDisponibilidadAdmin", () => {
  it("carga la reserva sin filtrar por dueño y calcula con sus horas_agenda guardadas y excluirReservaId", async () => {
    const doble = crearBdDoble({ reservas: [[{ horasAgenda: "3.5" }]] });
    const leerOcupacion = vi.fn(async () => ({ equipos: [{ id: 1 }], ocupadas: [] }));
    const dependencias = { ...dependenciasDeAdmin(() => doble.base), leerConfig: async () => VALORES_DEL_DISENO, leerOcupacion };
    const dia = await consultarDisponibilidadAdmin({ reservaId: ID, fecha: "2026-11-06", ahora: AHORA }, dependencias);

    const [lectura] = doble.lecturas();
    expect(lectura.donde?.params).toEqual([ID]); // solo el id: ningún usuario_id
    expect(leerOcupacion).toHaveBeenCalledWith(expect.objectContaining({ excluirReservaId: ID }));
    expect(dia.atendido).toBe(true);
    // Con 3,5 h de agenda el último inicio es a las 14:30 (termina a las 18:00).
    expect(dia.horarios.at(-1)?.hora).toBe("14:30");
    expect(dia.horarios.every((h) => h.disponible)).toBe(true);
  });

  it("una reserva inexistente da 404, un id «abc» da 404 y una fecha 2026-02-30 da 422", async () => {
    const vacio = crearBdDoble({ reservas: [[]] });
    const dependencias = { ...dependenciasDeAdmin(() => vacio.base), leerConfig: async () => VALORES_DEL_DISENO };
    await expect(consultarDisponibilidadAdmin({ reservaId: ID, fecha: "2026-11-06", ahora: AHORA }, dependencias)).rejects.toMatchObject({ status: 404 });
    await expect(consultarDisponibilidadAdmin({ reservaId: "abc", fecha: "2026-11-06", ahora: AHORA }, dependencias)).rejects.toMatchObject({ status: 404 });
    const con = crearBdDoble({ reservas: [[{ horasAgenda: "4.0" }]] });
    const otras = { ...dependenciasDeAdmin(() => con.base), leerConfig: async () => VALORES_DEL_DISENO };
    await expect(consultarDisponibilidadAdmin({ reservaId: ID, fecha: "2026-02-30", ahora: AHORA }, otras)).rejects.toMatchObject({ status: 422 });
  });
});
