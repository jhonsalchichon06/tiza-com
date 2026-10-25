import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { instanteLocal } from "../agenda/horario";
import { ErrorApi } from "../errores";
import type { Usuario } from "../sesion";
import { crearMiembroDoble, type Fila, type OpcionesMiembro } from "./__dobles__/miembro-doble";
import { crearReservaDeNuevoHorario, MENSAJE_GRATIS_TOMADA_AL_REUBICAR, type DependenciasNuevoHorario } from "./nuevo-horario";
import { MENSAJE_PAGO_EN_CREDITO } from "./nuevo-horario-datos";

const AHORA = instanteLocal("2026-11-02", "10:00", "America/Lima"); // lunes
const FIN = instanteLocal("2027-01-20", "10:00", "America/Lima");
const USUARIO: Usuario = { id: "u1", correo: "u1@tiza.test", nombre: "María Pérez", celular: "987654321", rol: "cliente" };
const PAGO_ID = "11111111-1111-4111-8111-111111111111";
const INICIO = "2026-11-07T10:00:00-05:00"; // sábado

const pago = (cambios: Fila = {}): Fila => ({
  id: PAGO_ID,
  usuarioId: "u1",
  concepto: "membresia_y_reserva",
  membresiaId: "m0",
  monto: 33666,
  metodo: "yape",
  estado: "aprobado",
  ...cambios,
});
// La reserva original expirada: una profunda 2/1 de 5 h con 3 horas gratis y monto 6966.
const origen = (cambios: Fila = {}): Fila => ({
  id: "r0",
  pagoId: PAGO_ID,
  usuarioId: "u1",
  membresiaId: "m0",
  estado: "expirada",
  tipo: "profunda",
  dormitorios: 2,
  banos: 1,
  horasTrabajo: "5.0",
  horasAgenda: "5.0",
  requiereApoyo: false,
  apoyoEstado: null,
  distrito: "Miraflores",
  calle: "Av. Larco",
  numero: "123",
  departamento: "Dpto. 302",
  departamentoNormalizado: "dpto 302",
  referencias: "Frente al parque",
  direccionNormalizada: "avenida larco 123",
  precioLista: 19350,
  horasGratisAplicadas: "3.0",
  creditoAplicado: "0.0",
  descuento: 774,
  monto: 6966,
  primeraGratis: true,
  ...cambios,
});

function montar(opciones: OpcionesMiembro = {}, extra: Partial<DependenciasNuevoHorario> = {}) {
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
  const dependencias: DependenciasNuevoHorario = {
    base: () => doble.base,
    leerConfig: async () => VALORES_DEL_DISENO,
    numeroWhatsapp: () => "51912345678",
    ...extra,
  };
  const crear = (cuerpo: unknown = { inicio: INICIO }, pagoId = PAGO_ID) => crearReservaDeNuevoHorario({ usuario: USUARIO, pagoId, cuerpo, ahora: AHORA }, dependencias);
  return { ...doble, crear };
}

async function error(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("se esperaba un error");
}

describe("crearReservaDeNuevoHorario", () => {
  it("crea la reserva confirmada con el mismo pago y sin pago nuevo", async () => {
    const m = montar();
    const r = await m.crear();
    expect(m.estado.pagos).toHaveLength(0);
    expect(m.estado.operaciones).not.toContain("insert:pagos");
    expect(m.estado.reservas).toHaveLength(1);
    expect(m.estado.reservas[0]).toMatchObject({ pagoId: PAGO_ID, estado: "confirmada", expiraEn: null, usuarioId: "u1", membresiaId: "m1" });
    expect(r.reserva).toMatchObject({ estado: "confirmada", expira_en: null, monto: 6966 });
    expect(r.pago).toMatchObject({ id: PAGO_ID, estado: "aprobado", concepto: "membresia_y_reserva" });
    expect(decodeURIComponent(r.whatsapp!.split("?text=")[1])).toContain("Estado: confirmada.");
  });

  it("conserva servicio, dirección, horas gratis, descuento, monto y primera_gratis sin recalcular", async () => {
    const m = montar({}, { leerConfig: async () => ({ ...VALORES_DEL_DISENO, descuento_miembro: 0.5, horas_gratis: 0 }) });
    await m.crear();
    expect(m.estado.reservas[0]).toMatchObject({
      tipo: "profunda",
      dormitorios: 2,
      banos: 1,
      horasTrabajo: "5.0",
      horasAgenda: "5.0",
      distrito: "Miraflores",
      calle: "Av. Larco",
      numero: "123",
      departamento: "Dpto. 302",
      referencias: "Frente al parque",
      direccionNormalizada: "avenida larco 123",
      precioLista: 19350,
      horasGratisAplicadas: "3.0",
      descuento: 774,
      monto: 6966,
      primeraGratis: true,
    });
  });

  it("ocupa las horas de agenda guardadas más el traslado", async () => {
    const m = montar();
    await m.crear();
    const r = m.estado.reservas[0];
    expect((r.inicio as Date).toISOString()).toBe("2026-11-07T15:00:00.000Z");
    expect((r.fin as Date).toISOString()).toBe("2026-11-07T20:00:00.000Z");
    expect((r.finBloqueo as Date).toISOString()).toBe("2026-11-07T21:00:00.000Z");
  });

  it("la reserva original no se toca (sigue expirada)", async () => {
    const m = montar();
    await m.crear();
    expect(m.estado.operaciones.filter((o) => o === "update:expirar")).toHaveLength(1); // solo la pasada inicial
    expect(m.estado.reservas.every((r) => r.id !== "r0")).toBe(true);
  });

  it("bloquea el pago con FOR UPDATE y empieza con expirarVencidas", async () => {
    const m = montar();
    await m.crear();
    expect(m.estado.operaciones[0]).toBe("update:expirar");
    expect(m.estado.operaciones).toContain("select:pagos:bloqueo");
  });

  it("un pago de concepto reserva aprobado tarde también se usa", async () => {
    const m = montar({ pagoPropio: pago({ concepto: "reserva", membresiaId: null, monto: 6966 }), reservaOrigen: origen({ primeraGratis: true }) });
    await expect(m.crear()).resolves.toMatchObject({ pago: { concepto: "reserva" } });
    expect(m.estado.reservas[0].membresiaId).toBe("m1");
  });

  it("una reserva cancelada por el administrador sí admite el nuevo horario", async () => {
    const m = montar({ ultimasDePagos: [{ pagoId: PAGO_ID, estado: "cancelada", canceladaPor: "admin" }], reservaOrigen: origen({ estado: "cancelada" }) });
    await expect(m.crear()).resolves.toBeDefined();
  });

  it("si requiere apoyo, nace por_coordinar", async () => {
    const m = montar({ reservaOrigen: origen({ requiereApoyo: true, apoyoEstado: "coordinado", horasTrabajo: "7.0", horasAgenda: "3.5" }) });
    await m.crear({ inicio: "2026-11-07T08:00:00-05:00" });
    expect(m.estado.reservas[0]).toMatchObject({ requiereApoyo: true, apoyoEstado: "por_coordinar" });
  });

  it("una cancelada por el cliente → 409 pago_en_credito sin escribir", async () => {
    const m = montar({ ultimasDePagos: [{ pagoId: PAGO_ID, estado: "cancelada", canceladaPor: "cliente" }] });
    expect(await error(m.crear())).toMatchObject({ status: 409, codigo: "pago_en_credito", message: MENSAJE_PAGO_EN_CREDITO });
    expect(m.estado.reservas).toHaveLength(0);
  });

  it.each(["pendiente", "rechazado"])("un pago %s → 409", async (estado) => {
    const m = montar({ pagoPropio: pago({ estado }) });
    expect(await error(m.crear())).toMatchObject({ status: 409 });
    expect(m.estado.reservas).toHaveLength(0);
  });

  describe("crédito en horas (decisión 4 de credito-en-horas)", () => {
    const lote = (id: string, horas: number) => ({ id, venceEn: new Date("2027-01-01T00:00:00Z"), horasDisponibles: horas });
    const conCredito = (horas: string) => ({ reservaOrigen: origen({ horasGratisAplicadas: "0.0", creditoAplicado: horas, horasTrabajo: "4.0", horasAgenda: "4.0", tipo: "estandar" }) });

    it("sin crédito en la reserva original no lee ni toca los lotes", async () => {
      const m = montar({ lotes: [lote("a", 4)] });
      const r = await m.crear();
      expect(m.estado.operaciones).not.toContain("select:creditos:bloqueo");
      expect(r.credito_faltante_horas).toBe(0);
    });

    it("crédito suficiente: vuelve a tomar las horas como consumido, sin faltante", async () => {
      const m = montar({ ...conCredito("2.0"), lotes: [lote("a", 3)] });
      const r = await m.crear();
      expect(m.estado.usos).toEqual([{ creditoId: "a", reservaId: m.estado.reservas[0].id, horas: 2, estado: "consumido" }]);
      expect(r.credito_faltante_horas).toBe(0);
      expect(m.estado.reservas[0]).toMatchObject({ estado: "confirmada", creditoAplicado: "2.0" });
    });

    it("bloquea los lotes antes de insertar la reserva", async () => {
      const m = montar({ ...conCredito("2.0"), lotes: [lote("a", 3)] });
      await m.crear();
      const o = m.estado.operaciones;
      expect(o.indexOf("select:creditos:bloqueo")).toBeLessThan(o.indexOf("insert:reservas"));
    });

    it("faltante: toma lo que haya, crea la reserva igual y lo informa", async () => {
      const m = montar({ ...conCredito("2.5"), lotes: [lote("a", 1)] });
      const r = await m.crear();
      expect(m.estado.reservas).toHaveLength(1);
      expect(m.estado.usos).toEqual([expect.objectContaining({ creditoId: "a", horas: 1, estado: "consumido" })]);
      expect(r.credito_faltante_horas).toBe(1.5);
    });

    it("sin ningún lote: la reserva se crea y todo el crédito original queda como faltante", async () => {
      const m = montar(conCredito("2.0"));
      const r = await m.crear();
      expect(m.estado.reservas).toHaveLength(1);
      expect(m.estado.usos).toEqual([]);
      expect(r.credito_faltante_horas).toBe(2);
    });

    it("sin cupo no descuenta nada", async () => {
      const m = montar({ ...conCredito("2.0"), lotes: [lote("a", 3)], sinCupo: true });
      await error(m.crear());
      expect(m.estado.usos).toEqual([]);
      expect(m.estado.descuentos).toEqual([]);
    });
  });

  it("un pago que ya tiene una reserva viva → 409", async () => {
    expect(await error(montar({ pagosSinHorario: [] }).crear())).toMatchObject({ status: 409 });
  });

  it("un reintento tras un COMMIT perdido → 409 «Ese pago ya tiene una reserva asociada.»", async () => {
    const m = montar({
      falloAlInsertarReserva: Object.assign(new Error("duplicate"), { cause: { code: "23505", constraint: "reservas_un_pago_por_reserva_viva" } }),
    });
    expect(await error(m.crear())).toMatchObject({ status: 409, message: "Ese pago ya tiene una reserva asociada." });
    expect(m.estado.reservas).toHaveLength(0);
  });

  it("menos de 48 horas → 422", async () => {
    const m = montar();
    expect(await error(m.crear({ inicio: "2026-11-04T09:00:00-05:00" }))).toMatchObject({ status: 422, message: expect.stringMatching(/48 horas/) });
    expect(m.estado.reservas).toHaveLength(0);
  });

  it("domingo o fuera del horario → 422", async () => {
    expect(await error(montar().crear({ inicio: "2026-11-08T10:00:00-05:00" }))).toMatchObject({ status: 422 });
    // 5 h de agenda desde las 15:00 terminarían a las 8 pm.
    expect(await error(montar().crear({ inicio: "2026-11-07T15:00:00-05:00" }))).toMatchObject({ status: 422 });
  });

  it("igual o posterior al fin de la membresía → 422 y el pago queda intacto", async () => {
    const inicio = instanteLocal("2026-11-07", "10:00", "America/Lima");
    for (const fin of [inicio, instanteLocal("2026-11-06", "10:00", "America/Lima")]) {
      const m = montar({ membresia: { id: "m1", fin, vigente: true } });
      expect(await error(m.crear())).toMatchObject({ status: 422, message: expect.stringMatching(/renueva tu membresía/) });
      expect(m.estado.reservas).toHaveLength(0);
      expect(m.estado.pagos).toHaveLength(0);
    }
  });

  it("sin cupo → 409 conflicto y el pago queda intacto para volver a intentar", async () => {
    const m = montar({ sinCupo: true });
    expect(await error(m.crear())).toMatchObject({ status: 409, codigo: "conflicto" });
    expect(m.estado.reservas).toHaveLength(0);
    // Con cupo después, el mismo pago funciona.
    const despues = montar();
    await expect(despues.crear()).resolves.toBeDefined();
  });

  it("la gratis tomada por otra cuenta → 409 limpieza_gratis_usada que pide escribir por WhatsApp", async () => {
    const m = montar({
      falloAlInsertarReserva: Object.assign(new Error("duplicate"), { cause: { code: "23505", constraint: "reservas_primera_gratis_por_hogar" } }),
    });
    expect(await error(m.crear())).toMatchObject({ status: 409, codigo: "limpieza_gratis_usada", message: MENSAJE_GRATIS_TOMADA_AL_REUBICAR });
    expect(MENSAJE_GRATIS_TOMADA_AL_REUBICAR).toMatch(/WhatsApp/);
  });

  it("un comprobante, monto o método en el cuerpo se ignoran y no se guardan", async () => {
    const m = montar();
    await m.crear({ inicio: INICIO, comprobante: "comprobantes/u1/x.jpg", monto: 1, metodo: "yape" });
    expect(JSON.stringify(m.estado.reservas)).not.toContain("comprobantes/");
    expect(m.estado.reservas[0].monto).toBe(6966);
    expect(m.estado.pagos).toHaveLength(0);
  });

  it("el pago de otro cliente o un id que no es uuid → 404", async () => {
    expect(await error(montar({ pagoPropio: pago({ usuarioId: "otro" }) }).crear())).toMatchObject({ status: 404 });
    expect(await error(montar().crear({ inicio: INICIO }, "abc"))).toMatchObject({ status: 404 });
  });

  it("un cuerpo sin inicio o con un inicio sin zona → 422", async () => {
    expect(await error(montar().crear({}))).toMatchObject({ status: 422 });
    expect(await error(montar().crear({ inicio: "2026-11-07T10:00:00" }))).toMatchObject({ status: 422 });
  });
});
