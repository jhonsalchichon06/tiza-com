import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../../__fixtures__/configuracion";
import type { ErrorApi } from "../../errores";
import { crearBdDoble, type Guion } from "../../perfil/__dobles__/bd-doble";
import { LARGO_MAXIMO_DE_NOTA, listarApoyoPorCoordinar, marcarApoyoCoordinado, MENSAJE_SIN_APOYO } from "./apoyo";

const CONFIG = VALORES_DEL_DISENO;
const ID = "33333333-3333-4333-8333-333333333333";

async function error(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("se esperaba un error");
}

const filaApoyo = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  estado: "confirmada",
  distrito: "Miraflores",
  calle: "Av. Larco",
  numero: "123",
  departamento: null,
  referencias: null,
  inicio: new Date("2026-11-09T13:00:00Z"),
  fin: new Date("2026-11-09T16:30:00Z"),
  horasTrabajo: "7.0",
  horasAgenda: "3.5",
  apoyoNota: null,
  pagoId: "22222222-2222-4222-8222-222222222222",
  clienteId: "u1",
  clienteNombre: "María Pérez",
  clienteCorreo: "maria@tiza.test",
  clienteCelular: "987654321",
  diasRestantes: "4",
  yaEmpezo: false,
  ...extra,
});

describe("listarApoyoPorCoordinar", () => {
  it("devuelve la forma de cada fila con la hora de Lima y los días restantes numéricos, en el orden recibido", async () => {
    const doble = crearBdDoble({ reservas: [[filaApoyo({ id: "a", diasRestantes: 1 }), filaApoyo({ id: "b", diasRestantes: "3", estado: "pendiente", apoyoNota: null })]] });
    const lista = await listarApoyoPorCoordinar(doble.base, CONFIG);
    expect(lista.map((x) => x.id)).toEqual(["a", "b"]);
    expect(lista[0]).toEqual({
      id: "a",
      estado: "confirmada",
      cliente: { id: "u1", nombre: "María Pérez", correo: "maria@tiza.test", celular: "987654321" },
      direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: null, referencias: null },
      inicio: "2026-11-09T08:00:00-05:00",
      fin: "2026-11-09T11:30:00-05:00",
      horas_trabajo: 7,
      horas_agenda: 3.5,
      apoyo_nota: null,
      dias_restantes: 1,
      pago_id: "22222222-2222-4222-8222-222222222222",
      puede_reprogramar: true,
    });
    expect(lista[1]).toMatchObject({ estado: "pendiente", dias_restantes: 3 });
  });

  it("filtra por apoyo requerido, por_coordinar y reserva viva (excluye coordinadas, terminadas, vencidas y sin apoyo)", async () => {
    const doble = crearBdDoble({ reservas: [[]] });
    await listarApoyoPorCoordinar(doble.base, CONFIG);
    const donde = doble.lecturas()[0].donde!;
    expect(donde.sql).toContain(`"reservas"."requiere_apoyo" = $`);
    expect(donde.sql).toContain(`"reservas"."apoyo_estado" = $`);
    expect(donde.sql).toContain(`"reservas"."expira_en" > now()`);
    expect(donde.params).toEqual(expect.arrayContaining([true, "por_coordinar", "confirmada", "pendiente"]));
    // completada, cancelada y expirada no están entre los estados aceptados por reservaActiva
    expect(donde.params).not.toEqual(expect.arrayContaining(["completada"]));
    expect(donde.params).not.toEqual(expect.arrayContaining(["coordinado"]));
  });

  it("una lista vacía devuelve []", async () => {
    const doble = crearBdDoble({ reservas: [[]] });
    expect(await listarApoyoPorCoordinar(doble.base, CONFIG)).toEqual([]);
  });
});

const montar = (guion: Guion) => {
  const doble = crearBdDoble(guion);
  return { doble, marcar: (cuerpo: unknown = { nota: "María" }, id = ID) => marcarApoyoCoordinado({ reservaId: id, cuerpo }, { base: () => doble.base }) };
};
const reserva = (extra: Record<string, unknown> = {}) => [{ id: ID, estado: "confirmada", requiereApoyo: true, ...extra }];

describe("marcarApoyoCoordinado", () => {
  it("marca con nota, la recorta, bloquea la fila y solo escribe apoyo_estado y apoyo_nota", async () => {
    const m = montar({ reservas: [reserva(), [{ id: ID, apoyoNota: "María Pérez, 987654321" }]] });
    const r = await m.marcar({ nota: "  María Pérez, 987654321  " });
    expect(r).toEqual({ reserva: { id: ID, apoyo_estado: "coordinado", apoyo_nota: "María Pérez, 987654321" } });
    expect(m.doble.estado.expiraciones).toBe(1);
    expect(m.doble.bloqueos()).toEqual(["reservas"]);
    const [escritura] = m.doble.escrituras();
    expect(escritura.set).toEqual({ apoyoEstado: "coordinado", apoyoNota: "María Pérez, 987654321" });
  });

  it.each([["sin cuerpo", undefined], ["objeto vacío", {}], ["nota vacía", { nota: "" }], ["solo espacios", { nota: "   " }]])("%s: queda coordinado con la nota vacía", async (_n, cuerpo) => {
    const m = montar({ reservas: [reserva(), [{ id: ID, apoyoNota: null }]] });
    // `montar` usa un valor por defecto si el cuerpo es undefined: se pasa null explícito para «sin cuerpo»
    const r = await m.marcar(cuerpo === undefined ? null : cuerpo);
    expect(r.reserva).toEqual({ id: ID, apoyo_estado: "coordinado", apoyo_nota: null });
    expect(m.doble.escrituras()[0].set).toEqual({ apoyoEstado: "coordinado", apoyoNota: null });
  });

  it("acepta 500 caracteres y rechaza 501 con 422 sin abrir la transacción", async () => {
    const ok = montar({ reservas: [reserva(), [{ id: ID, apoyoNota: "x".repeat(500) }]] });
    expect((await ok.marcar({ nota: "x".repeat(LARGO_MAXIMO_DE_NOTA) })).reserva.apoyo_nota).toHaveLength(500);
    const largo = montar({});
    expect(await error(largo.marcar({ nota: "x".repeat(LARGO_MAXIMO_DE_NOTA + 1) }))).toMatchObject({ status: 422 });
    expect(largo.doble.estado.transacciones).toBe(0);
  });

  it("repetir sobre una ya coordinada reescribe la nota (200)", async () => {
    const m = montar({ reservas: [reserva({ apoyoEstado: "coordinado" }), [{ id: ID, apoyoNota: "Rosa, 911222333" }]] });
    const r = await m.marcar({ nota: "Rosa, 911222333" });
    expect(r.reserva).toMatchObject({ apoyo_estado: "coordinado", apoyo_nota: "Rosa, 911222333" });
  });

  it("una pendiente vigente también se puede marcar", async () => {
    const m = montar({ reservas: [reserva({ estado: "pendiente" }), [{ id: ID, apoyoNota: null }]] });
    expect((await m.marcar({})).reserva.apoyo_estado).toBe("coordinado");
  });

  it("una reserva sin apoyo da 409 «Esta reserva no requiere apoyo.» sin escribir", async () => {
    const m = montar({ reservas: [reserva({ requiereApoyo: false })] });
    expect(await error(m.marcar())).toMatchObject({ status: 409, message: MENSAJE_SIN_APOYO });
    expect(m.doble.escrituras()).toEqual([]);
  });

  it.each(["completada", "cancelada", "expirada"])("una reserva %s da 409 que nombra su estado", async (estado) => {
    const m = montar({ reservas: [reserva({ estado })] });
    const e = await error(m.marcar());
    expect(e.status).toBe(409);
    expect(e.message).toContain(estado);
    expect(m.doble.escrituras()).toEqual([]);
  });

  it("inexistente da 404 y «abc» da 404 sin transacción", async () => {
    const m = montar({ reservas: [[]] });
    expect(await error(m.marcar())).toMatchObject({ status: 404 });
    const n = montar({});
    expect(await error(n.marcar({}, "abc"))).toMatchObject({ status: 404 });
    expect(n.doble.estado.transacciones).toBe(0);
  });

  it("no toca equipo, horario, precio ni estado", async () => {
    const m = montar({ reservas: [reserva(), [{ id: ID, apoyoNota: null }]] });
    await m.marcar({});
    const columnas = Object.keys(m.doble.escrituras()[0].set!);
    for (const c of ["equipoId", "inicio", "fin", "finBloqueo", "monto", "precioLista", "estado"]) expect(columnas).not.toContain(c);
  });
});

describe("listarApoyoPorCoordinar: acceso a reprogramar", () => {
  it("cada fila trae el celular del cliente y puede_reprogramar si el servicio no empezó", async () => {
    const doble = crearBdDoble({ reservas: [[filaApoyo({ id: "a" }), filaApoyo({ id: "b", yaEmpezo: true })]] });
    const [a, b] = await listarApoyoPorCoordinar(doble.base, CONFIG);
    expect(a).toMatchObject({ puede_reprogramar: true, cliente: { celular: "987654321" } });
    expect(b.puede_reprogramar).toBe(false);
  });
});
