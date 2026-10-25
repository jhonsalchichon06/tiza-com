import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { instanteLocal } from "../agenda/horario";
import { ErrorApi } from "../errores";
import { crearMiembroDoble, type Fila, type OpcionesMiembro } from "./__dobles__/miembro-doble";
import {
  leerDisponibilidadNuevoHorario,
  leerNuevoHorario,
  MENSAJE_PAGO_EN_CREDITO,
  type DependenciasNuevoHorarioDatos,
} from "./nuevo-horario-datos";

const AHORA = instanteLocal("2026-11-02", "10:00", "America/Lima");
const FIN = instanteLocal("2027-01-20", "10:00", "America/Lima");
const PAGO_ID = "11111111-1111-4111-8111-111111111111";
const USUARIO = { id: "u1" };

const pago = (cambios: Fila = {}): Fila => ({ id: PAGO_ID, usuarioId: "u1", concepto: "membresia_y_reserva", monto: 33666, estado: "aprobado", ...cambios });
const origen = (cambios: Fila = {}): Fila => ({
  id: "r0",
  pagoId: PAGO_ID,
  tipo: "profunda",
  dormitorios: 2,
  banos: 1,
  horasTrabajo: "5.0",
  horasAgenda: "5.0",
  horasGratisAplicadas: "3.0",
  requiereApoyo: false,
  distrito: "Miraflores",
  calle: "Av. Larco",
  numero: "123",
  departamento: "Dpto. 302",
  referencias: null,
  ...cambios,
});

function montar(opciones: OpcionesMiembro = {}, extra: Partial<DependenciasNuevoHorarioDatos> = {}) {
  const doble = crearMiembroDoble(
    {
      membresia: { id: "m1", fin: FIN, vigente: true },
      pagoPropio: pago(),
      pagosSinHorario: [{ id: PAGO_ID }],
      ultimasDePagos: [{ pagoId: PAGO_ID, estado: "expirada", canceladaPor: null }],
      reservaOrigen: origen(),
      ...opciones,
    },
    () => AHORA,
  );
  const dependencias: DependenciasNuevoHorarioDatos = {
    base: () => doble.lector,
    leerConfig: async () => VALORES_DEL_DISENO,
    leerOcupacion: async () => ({ equipos: [{ id: 1 }, { id: 2 }], ocupadas: [] }),
    ...extra,
  };
  return {
    ...doble,
    datos: (pagoId = PAGO_ID, usuario = USUARIO) => leerNuevoHorario({ usuario, pagoId, ahora: AHORA }, dependencias),
    disponibilidad: (fecha: unknown = "2026-11-07", pagoId = PAGO_ID) => leerDisponibilidadNuevoHorario({ usuario: USUARIO, pagoId, fecha, ahora: AHORA }, dependencias),
  };
}

async function error(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("se esperaba un error");
}

describe("leerNuevoHorario", () => {
  it("pago propio aprobado con la reserva expirada: devuelve servicio, dirección, horas gratis, monto y fechas", async () => {
    const d = await montar().datos();
    expect(d).toMatchObject({
      pago: { id: PAGO_ID, monto_pagado: 33666 },
      servicio: { tipo: "profunda", dormitorios: 2, banos: 1 },
      direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: "Dpto. 302" },
      horas_trabajo: 5,
      horas_agenda: 5,
      horas_gratis_aplicadas: 3,
      fechas: { desde: "2026-11-04", hasta: "2027-01-20" },
      limite: "2027-01-20T10:00:00-05:00",
      membresia_vigente: true,
    });
  });

  it("un paquete devuelve sus horas", async () => {
    const d = await montar({ reservaOrigen: origen({ tipo: "paquete", dormitorios: null, banos: null, horasTrabajo: "4.0" }) }).datos();
    expect(d.servicio).toEqual({ tipo: "paquete", horas: 4 });
  });

  it("un id que no es uuid → 404 sin consultar", async () => {
    const m = montar();
    expect(await error(m.datos("abc"))).toMatchObject({ status: 404 });
    expect(m.estado.lecturas).toHaveLength(0);
  });

  it("el pago de otro cliente → 404 (la consulta lleva el usuario de la sesión)", async () => {
    const m = montar({ pagoPropio: pago({ usuarioId: "otro" }) });
    expect(await error(m.datos())).toMatchObject({ status: 404 });
    expect(m.estado.lecturas[0].params).toContain("u1");
  });

  it("un administrador que no es el dueño → 404", async () => {
    const m = montar({ pagoPropio: pago({ usuarioId: "u1" }) });
    expect(await error(m.datos(PAGO_ID, { id: "admin-1" }))).toMatchObject({ status: 404 });
  });

  it("un pago inexistente → 404", async () => {
    expect(await error(montar({ pagoPropio: undefined }).datos())).toMatchObject({ status: 404 });
  });

  it.each(["pendiente", "rechazado"])("un pago %s → 409", async (estado) => {
    expect(await error(montar({ pagoPropio: pago({ estado }) }).datos())).toMatchObject({ status: 409 });
  });

  it("un pago que ya tiene una reserva viva → 409", async () => {
    expect(await error(montar({ pagosSinHorario: [] }).datos())).toMatchObject({ status: 409 });
  });

  it("el pago de una cancelación del cliente → 409 pago_en_credito", async () => {
    const m = montar({ ultimasDePagos: [{ pagoId: PAGO_ID, estado: "cancelada", canceladaPor: "cliente" }] });
    expect(await error(m.datos())).toMatchObject({ status: 409, codigo: "pago_en_credito", message: MENSAJE_PAGO_EN_CREDITO });
  });

  it("la cancelada por el administrador sí admite un nuevo horario", async () => {
    const m = montar({ ultimasDePagos: [{ pagoId: PAGO_ID, estado: "cancelada", canceladaPor: "admin" }] });
    await expect(m.datos()).resolves.toBeDefined();
  });

  it("con la membresía vencida muestra membresia_vigente falso y ningún día", async () => {
    const d = await montar({ membresia: { id: "m1", fin: instanteLocal("2026-10-20", "10:00", "America/Lima"), vigente: false } }).datos();
    expect(d.membresia_vigente).toBe(false);
    expect(d.fechas.hasta < d.fechas.desde).toBe(true);
  });

  it("no escribe nada", async () => {
    const m = montar();
    await m.datos();
    expect(m.estado.operaciones.filter((o) => o.startsWith("insert") || o.startsWith("update"))).toEqual([]);
  });
});

describe("leerDisponibilidadNuevoHorario", () => {
  it("calcula los horarios del día con las horas_agenda guardadas (5 h: el último inicio es las 13:00)", async () => {
    const d = await montar().disponibilidad();
    expect(d.atendido).toBe(true);
    expect(d.horarios.at(-1)).toMatchObject({ hora: "13:00", disponible: true });
    expect(d.horarios[0]).toMatchObject({ hora: "08:00", disponible: true });
  });

  it("aunque configuracion cambie, usa las horas guardadas", async () => {
    const m = montar({}, { leerConfig: async () => ({ ...VALORES_DEL_DISENO, horas_extra_tipo: { estandar: 0, profunda: 3, mudanza: 2 } }) });
    expect((await m.disponibilidad()).horarios.at(-1)).toMatchObject({ hora: "13:00" });
  });

  it("2026-02-30 → 422", async () => {
    expect(await error(montar().disponibilidad("2026-02-30"))).toMatchObject({ status: 422 });
  });

  it("un pago ajeno o no elegible responde igual que los datos", async () => {
    expect(await error(montar({ pagoPropio: pago({ usuarioId: "otro" }) }).disponibilidad())).toMatchObject({ status: 404 });
    expect(await error(montar({ ultimasDePagos: [{ pagoId: PAGO_ID, estado: "cancelada", canceladaPor: "cliente" }] }).disponibilidad())).toMatchObject({ codigo: "pago_en_credito" });
  });

  it("marca sin cupo cuando los dos equipos están ocupados", async () => {
    const inicio = instanteLocal("2026-11-07", "08:00", "America/Lima");
    const fin = new Date(inicio.getTime() + 8 * 3_600_000);
    const m = montar({}, { leerOcupacion: async () => ({ equipos: [{ id: 1 }, { id: 2 }], ocupadas: [{ equipoId: 1, inicio, finBloqueo: fin }, { equipoId: 2, inicio, finBloqueo: fin }] }) });
    const d = await m.disponibilidad();
    expect(d.horarios[0]).toMatchObject({ hora: "08:00", disponible: false, motivo: "sin_cupo" });
  });
});
