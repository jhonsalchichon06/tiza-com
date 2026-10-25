import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import type { ErrorApi } from "../errores";
import { crearTxDoble, render, type Guion } from "./__dobles__/tx-doble";
import { aprobarPago, rechazarPago, type DependenciasRevision } from "./revision";

const ADMIN = { id: "admin-1" };
const PAGO_ID = "11111111-1111-4111-8111-111111111111";
const MEMBRESIA_ID = "22222222-2222-4222-8222-222222222222";
const RESERVA_ID = "33333333-3333-4333-8333-333333333333";
const REVISADO = new Date("2026-11-02T15:00:00Z");

const pago = (extra: Record<string, unknown> = {}) => ({
  id: PAGO_ID,
  usuarioId: "u1",
  concepto: "membresia_y_reserva",
  membresiaId: MEMBRESIA_ID,
  monto: 33666,
  metodo: "yape",
  comprobanteRuta: "comprobantes/u1/x.jpg",
  estado: "pendiente",
  revisadoPor: null,
  revisadoEn: null,
  motivoRechazo: null,
  reemplazaA: null,
  creadoEn: new Date("2026-11-01T15:00:00Z"),
  ...extra,
});
const aprobado = (extra: Record<string, unknown> = {}) => pago({ estado: "aprobado", revisadoPor: ADMIN.id, revisadoEn: REVISADO, ...extra });
const membresiaActiva = { id: MEMBRESIA_ID, estado: "activa", inicio: REVISADO, fin: new Date("2027-02-02T15:00:00Z") };
const reserva = (estado: string, extra: Record<string, unknown> = {}) => ({
  id: RESERVA_ID,
  estado,
  expiraEn: null,
  creadaEn: new Date("2026-11-01T15:00:00Z"),
  ...extra,
});

function montar(guion: Guion, config: Partial<typeof VALORES_DEL_DISENO> = {}, falloEn?: Parameters<typeof crearTxDoble>[1]) {
  const doble = crearTxDoble(guion, falloEn);
  const dependencias: DependenciasRevision = {
    base: () => doble.base,
    leerConfig: async () => ({ ...VALORES_DEL_DISENO, ...config }),
  };
  return {
    ...doble,
    aprobar: (id = PAGO_ID) => aprobarPago({ admin: ADMIN, pagoId: id }, dependencias),
    rechazar: (cuerpo?: unknown, id = PAGO_ID) => rechazarPago({ admin: ADMIN, pagoId: id, cuerpo }, dependencias),
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

describe("aprobarPago", () => {
  it("aprobación normal: pago aprobado, membresía activa, reserva confirmada sin expira_en", async () => {
    const m = montar({
      pagos: [[pago()], [aprobado()]],
      membresias: [[membresiaActiva]],
      reservas: [[reserva("confirmada")]],
    });
    const r = await m.aprobar();
    expect(r.pago).toMatchObject({ id: PAGO_ID, estado: "aprobado" });
    expect(r.membresia).toMatchObject({ id: MEMBRESIA_ID, estado: "activa" });
    expect(r.reserva).toMatchObject({ id: RESERVA_ID, estado: "confirmada", expira_en: null });
    expect(r.nuevo_horario_pendiente).toBe(false);
    const [mem, pg, res] = m.escrituras();
    expect(mem).toMatchObject({ tabla: "membresias", set: { estado: "activa" } });
    expect(pg).toMatchObject({ tabla: "pagos", set: { estado: "aprobado", revisadoPor: "admin-1" } });
    expect(res).toMatchObject({ tabla: "reservas", set: { estado: "confirmada", expiraEn: null } });
  });

  it("bloquea el pago con FOR UPDATE y la transacción empieza marcando las vencidas", async () => {
    const m = montar({ pagos: [[pago()], [aprobado()]], membresias: [[membresiaActiva]], reservas: [[reserva("confirmada")]] });
    await m.aprobar();
    expect(m.bloqueos()).toEqual(["pagos"]);
    expect(m.estado.expiraciones).toBe(1);
    expect(m.estado.transacciones).toBe(1);
  });

  it("inicio y fin salen de now() de la base, no del reloj del servidor ni de pagos.creado_en", async () => {
    const m = montar({ pagos: [[pago()], [aprobado()]], membresias: [[membresiaActiva]], reservas: [[reserva("confirmada")]] });
    await m.aprobar();
    const mem = m.escrituras()[0];
    expect(typeof (mem.set!.inicio as object)).toBe("object"); // expresión SQL, no una fecha
    expect(typeof (mem.set!.fin as object)).toBe("object");
  });

  it.each([3, 2])("la duración sale de membresia_meses de configuración (%i meses)", async (meses) => {
    const m = montar({ pagos: [[pago()], [aprobado()]], membresias: [[membresiaActiva]], reservas: [[reserva("confirmada")]] }, { membresia_meses: meses });
    await m.aprobar();
    const fin = render(m.escrituras()[0].set!.fin)!;
    expect(fin.sql).toContain("make_interval(months =>");
    expect(fin.params).toContain(meses);
    const donde = m.escrituras()[0].donde!;
    expect(donde.params).toContain(MEMBRESIA_ID);
  });

  it("un pago de concepto reserva no toca membresías", async () => {
    const m = montar({ pagos: [[pago({ concepto: "reserva", membresiaId: null })], [aprobado({ concepto: "reserva", membresiaId: null })]], reservas: [[reserva("confirmada")]] });
    const r = await m.aprobar();
    expect(r.membresia).toBeNull();
    expect(m.escrituras().map((s) => s.tabla)).toEqual(["pagos", "reservas"]);
  });

  it.each(["aprobado", "rechazado"])("pago ya %s → 409 sin escribir", async (estado) => {
    const m = montar({ pagos: [[pago({ estado })]] });
    expect(await error(m.aprobar())).toMatchObject({ status: 409, message: expect.stringMatching(/ya fue revisado/) });
    expect(m.escrituras()).toEqual([]);
  });

  it("membresía no pendiente (por ejemplo caducada) → 409 sin marcar el pago", async () => {
    const m = montar({ pagos: [[pago()]], membresias: [[]] });
    expect(await error(m.aprobar())).toMatchObject({ status: 409, message: expect.stringMatching(/membresía/) });
    expect(m.escrituras().map((s) => s.tabla)).toEqual(["membresias"]);
    expect(m.estado.deshecha).toBe(true);
  });

  it("pago inexistente → 404", async () => {
    const m = montar({ pagos: [[]] });
    expect(await error(m.aprobar())).toMatchObject({ status: 404 });
    expect(m.escrituras()).toEqual([]);
  });

  it("un id sin formato de uuid → 404 sin abrir consulta", async () => {
    const m = montar({});
    expect(await error(m.aprobar("abc"))).toMatchObject({ status: 404 });
    expect(m.sentencias).toEqual([]);
  });

  describe("aprobación tardía", () => {
    it("reserva expirada: pago aprobado, membresía activa, reserva intacta y nuevo_horario_pendiente", async () => {
      const m = montar({
        pagos: [[pago()], [aprobado()]],
        membresias: [[membresiaActiva]],
        reservas: [[], [reserva("expirada", { expiraEn: new Date("2026-11-02T10:00:00Z") })]],
      });
      const r = await m.aprobar();
      expect(r.pago.estado).toBe("aprobado");
      expect(r.membresia?.estado).toBe("activa");
      expect(r.reserva).toMatchObject({ id: RESERVA_ID, estado: "expirada" });
      expect(r.nuevo_horario_pendiente).toBe(true);
    });

    it("reserva cancelada por el administrador: igual", async () => {
      const m = montar({ pagos: [[pago()], [aprobado()]], membresias: [[membresiaActiva]], reservas: [[], [reserva("cancelada")]] });
      const r = await m.aprobar();
      expect(r.reserva?.estado).toBe("cancelada");
      expect(r.nuevo_horario_pendiente).toBe(true);
    });

    it("reserva ya confirmada → nuevo_horario_pendiente falso", async () => {
      const m = montar({ pagos: [[pago()], [aprobado()]], membresias: [[membresiaActiva]], reservas: [[], [reserva("confirmada")]] });
      expect((await m.aprobar()).nuevo_horario_pendiente).toBe(false);
    });

    it("pago de reenvío sin reserva → reserva null y nuevo_horario_pendiente", async () => {
      const m = montar({ pagos: [[pago({ reemplazaA: "x" })], [aprobado()]], membresias: [[membresiaActiva]], reservas: [[], []] });
      const r = await m.aprobar();
      expect(r.reserva).toBeNull();
      expect(r.nuevo_horario_pendiente).toBe(true);
    });

    it("la UPDATE de confirmar solo toca reservas pendientes del pago", async () => {
      const m = montar({ pagos: [[pago()], [aprobado()]], membresias: [[membresiaActiva]], reservas: [[], []] });
      await m.aprobar();
      const res = m.escrituras().find((s) => s.tabla === "reservas")!;
      expect(res.donde!.params).toEqual(expect.arrayContaining([PAGO_ID, "pendiente"]));
    });
  });

  it("si la lectura del pago falla por la conexión el error se propaga", async () => {
    const corte = Object.assign(new Error("Connection terminated"), { code: "ECONNRESET" });
    const m = montar({ pagos: [[pago()]] }, {}, { falloEn: (s) => (s.tipo === "select" ? corte : undefined) });
    expect(await error(m.aprobar())).toBe(corte);
  });
});

describe("aprobarPago y el crédito en horas", () => {
  const LOTE = { id: "l1", horas_iniciales: "2", vence_en: new Date("2027-02-02T15:00:00Z") };

  it("reserva confirmada: sus usos pasan a consumido", async () => {
    const m = montar({ pagos: [[pago()], [aprobado()]], membresias: [[membresiaActiva]], reservas: [[reserva("confirmada")]] });
    const r = await m.aprobar();
    const [uso] = m.ejecuciones();
    expect(m.ejecuciones()).toHaveLength(1);
    expect(uso.texto).toContain(`SET "estado" = 'consumido'`);
    expect(uso.params).toEqual([RESERVA_ID]);
    expect(r.credito_generado).toBeNull();
  });

  it("reserva expirada: no toca usos ni genera lote", async () => {
    const m = montar({ pagos: [[pago()], [aprobado()]], membresias: [[membresiaActiva]], reservas: [[], [reserva("expirada")]] });
    const r = await m.aprobar();
    expect(m.ejecuciones()).toHaveLength(0);
    expect(r.credito_generado).toBeNull();
  });

  it("reserva cancelada por el cliente: genera el lote y lo informa", async () => {
    const m = montar({
      pagos: [[pago()], [aprobado()]],
      membresias: [[membresiaActiva]],
      reservas: [[], [reserva("cancelada", { canceladaPor: "cliente" })]],
      creditos: [[LOTE]],
    });
    const r = await m.aprobar();
    expect(m.ejecuciones()).toHaveLength(1);
    expect(m.ejecuciones()[0].texto).toContain('INSERT INTO "creditos_horas"');
    expect(m.ejecuciones()[0].params).toContain(RESERVA_ID);
    expect(m.ejecuciones()[0].params).toContain(VALORES_DEL_DISENO.credito_vence_meses);
    expect(r.credito_generado).toEqual({ horas: 2, vence_en: "2027-02-02T10:00:00-05:00" });
  });

  it("reserva cancelada por el cliente sin horas pagadas (la sentencia no inserta): sin crédito", async () => {
    const m = montar({ pagos: [[pago()], [aprobado()]], membresias: [[membresiaActiva]], reservas: [[], [reserva("cancelada", { canceladaPor: "cliente" })]] });
    expect((await m.aprobar()).credito_generado).toBeNull();
  });

  it("reserva cancelada por el administrador: no genera", async () => {
    const m = montar({ pagos: [[pago()], [aprobado()]], membresias: [[membresiaActiva]], reservas: [[], [reserva("cancelada", { canceladaPor: "admin" })]] });
    const r = await m.aprobar();
    expect(m.ejecuciones()).toHaveLength(0);
    expect(r.credito_generado).toBeNull();
  });

  it("concepto sin reserva: no hay sentencias de crédito", async () => {
    const m = montar({ pagos: [[pago({ concepto: "membresia" })], [aprobado({ concepto: "membresia" })]], membresias: [[membresiaActiva]], reservas: [[], []] });
    const r = await m.aprobar();
    expect(m.ejecuciones()).toHaveLength(0);
    expect(r.credito_generado).toBeNull();
  });
});

describe("rechazarPago", () => {
  const rechazadoFila = (extra: Record<string, unknown> = {}) => ({
    id: PAGO_ID,
    estado: "rechazado",
    motivoRechazo: null,
    revisadoEn: REVISADO,
    reenvioHasta: "2026-11-09T15:00:00.000Z",
    reenvioVigente: true,
    ...extra,
  });

  it("rechaza sin motivo: no toca la reserva ni la membresía y devuelve el plazo", async () => {
    const m = montar({ pagos: [[pago()], [rechazadoFila()]] });
    const r = await m.rechazar();
    expect(r.pago).toMatchObject({ id: PAGO_ID, estado: "rechazado", motivo_rechazo: null });
    expect(r.reenvio_hasta).toBe("2026-11-09T10:00:00-05:00");
    expect(r.reenvio_vigente).toBe(true);
    expect(m.escrituras().map((s) => s.tabla)).toEqual(["pagos"]);
    expect(m.escrituras()[0].set).toMatchObject({ estado: "rechazado", revisadoPor: "admin-1", motivoRechazo: null });
    expect(m.bloqueos()).toEqual(["pagos"]);
  });

  it("no ejecuta ninguna sentencia sobre usos_credito ni creditos_horas (las horas vuelven al expirar)", async () => {
    const m = montar({ pagos: [[pago()], [rechazadoFila()]] });
    await m.rechazar();
    expect(m.ejecuciones()).toHaveLength(0);
    expect(m.sentencias.every((s) => !(s.texto ?? "").includes("usos_credito") && !(s.texto ?? "").includes("creditos_horas"))).toBe(true);
  });

  it("guarda el motivo recortado", async () => {
    const m = montar({ pagos: [[pago()], [rechazadoFila({ motivoRechazo: "El comprobante no coincide" })]] });
    const r = await m.rechazar({ motivo: "  El comprobante no coincide  " });
    expect(m.escrituras()[0].set!.motivoRechazo).toBe("El comprobante no coincide");
    expect(r.pago.motivo_rechazo).toBe("El comprobante no coincide");
  });

  it("un motivo de 200 caracteres se acepta; de 201 → 422 sin abrir la transacción", async () => {
    const ok = montar({ pagos: [[pago()], [rechazadoFila()]] });
    await ok.rechazar({ motivo: "a".repeat(200) });
    const largo = montar({ pagos: [[pago()]] });
    expect(await error(largo.rechazar({ motivo: "a".repeat(201) }))).toMatchObject({ status: 422, message: expect.stringMatching(/200/) });
    expect(largo.estado.transacciones).toBe(0);
  });

  it("un motivo que no es texto → 422", async () => {
    const m = montar({ pagos: [[pago()]] });
    expect(await error(m.rechazar({ motivo: 5 }))).toMatchObject({ status: 422 });
  });

  it.each(["aprobado", "rechazado"])("pago ya %s → 409", async (estado) => {
    const m = montar({ pagos: [[pago({ estado })]] });
    expect(await error(m.rechazar())).toMatchObject({ status: 409 });
    expect(m.escrituras()).toEqual([]);
  });

  it("pago inexistente → 404", async () => {
    const m = montar({ pagos: [[]] });
    expect(await error(m.rechazar())).toMatchObject({ status: 404 });
  });

  it.each([7, 2])("el plazo sale de reenvio_comprobante_dias de configuración (%i días)", async (dias) => {
    const m = montar({ pagos: [[pago()], [rechazadoFila()]] }, { reenvio_comprobante_dias: dias });
    await m.rechazar();
    // Los días llegan a la sentencia como parámetro (en el UPDATE ... RETURNING), no escritos en el código.
    const retornos = m.escrituras()[0].returning as Record<string, unknown>;
    const q = render(retornos.reenvioHasta)!;
    expect(q.sql).toContain("make_interval(days =>");
    expect(q.params).toContain(dias);
  });
});
