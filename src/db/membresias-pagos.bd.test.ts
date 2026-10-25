import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { membresias, pagos, reservas, usuarios } from "./esquema";
import {
  PRUEBAS_BD_ACTIVAS,
  contarRastros,
  crearBasePruebas,
  crearEscenario,
  enRollback,
  filaReserva,
  type BasePruebas,
  type Dueno,
} from "./pruebas-bd";

type Tx = Parameters<Parameters<BasePruebas["transaction"]>[0]>[0];
type Tabla = typeof membresias | typeof pagos | typeof reservas;

// Inserta en un SAVEPOINT para que un rechazo no aborte la transacción de la prueba. Devuelve "ok" o el SQLSTATE.
async function intentar(tx: Tx, tabla: Tabla, valores: unknown): Promise<string> {
  try {
    await tx.transaction(async (sp) => {
      await sp.insert(tabla as typeof membresias).values(valores as typeof membresias.$inferInsert);
    });
    return "ok";
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code ?? "error";
  }
}

// Membresías, pagos y su vínculo con las reservas contra Neon real. Corre con PRUEBAS_BD=1, con ROLLBACK y fechas de 2099.
describe.skipIf(!PRUEBAS_BD_ACTIVAS)("membresías, pagos y vínculo con reservas (Neon)", () => {
  let ctx: ReturnType<typeof crearBasePruebas>;
  let base: BasePruebas;
  let esc: Awaited<ReturnType<typeof crearEscenario>>;
  let duenos: Dueno[];
  let siguiente = 0;
  let contador = 0;

  beforeAll(async () => {
    ctx = crearBasePruebas();
    base = ctx.base;
    esc = await crearEscenario(base);
    duenos = await esc.crearDuenos(6);
  });

  beforeEach(() => {
    siguiente = 0;
  });

  afterAll(async () => {
    await esc?.limpiar();
    if (base) expect(await contarRastros(base)).toBe(0);
    await ctx?.cerrar();
  });

  const dueno = () => duenos[siguiente++];
  const inicio = "2099-07-06T10:00:00-05:00";
  // Un usuario nuevo dentro de la transacción (se deshace con ella). Lleva el prefijo de las pruebas.
  async function usuarioNuevo(tx: Tx): Promise<string> {
    const id = `prueba-agenda-${esc.usuarioId.slice(-8)}-m${++contador}`;
    await tx.insert(usuarios).values({ id, name: "Prueba membresía", email: `${id}@tiza.test`, telefono: "900000000" });
    return id;
  }
  const reserva = (d: Dueno, extra: Partial<Parameters<typeof filaReserva>[0]> = {}, hora = inicio, equipo = 0) =>
    filaReserva({ ...d, equipoId: esc.equipoIds[equipo], inicio: hora, horasAgenda: 2, ...extra });

  describe("membresías", () => {
    const pendiente = (usuarioId: string) => ({ usuarioId, monto: 26700, estado: "pendiente" as const });
    const activa = (usuarioId: string) => ({
      usuarioId,
      monto: 26700,
      estado: "activa" as const,
      inicio: new Date("2099-07-01T15:00:00Z"),
      fin: new Date("2099-10-01T15:00:00Z"),
    });

    it("una pendiente sin fechas y una activa con fechas son válidas", async () => {
      await enRollback(base, async (tx) => {
        expect(await intentar(tx, membresias, pendiente(await usuarioNuevo(tx)))).toBe("ok");
        expect(await intentar(tx, membresias, activa(await usuarioNuevo(tx)))).toBe("ok");
      });
    });

    it.each([
      ["pendiente con fechas", (u: string) => ({ ...pendiente(u), inicio: new Date("2099-07-01T15:00:00Z"), fin: new Date("2099-10-01T15:00:00Z") })],
      ["activa sin fechas", (u: string) => ({ usuarioId: u, monto: 26700, estado: "activa" as const })],
      ["activa con fin igual al inicio", (u: string) => ({ ...activa(u), fin: activa(u).inicio })],
      ["activa con fin antes del inicio", (u: string) => ({ ...activa(u), fin: new Date("2099-06-01T15:00:00Z") })],
      ["monto 0", (u: string) => ({ ...pendiente(u), monto: 0 })],
    ])("rechaza %s con 23514", async (_nombre, construir) => {
      await enRollback(base, async (tx) => {
        expect(await intentar(tx, membresias, construir(await usuarioNuevo(tx)))).toBe("23514");
      });
    });

    it("una segunda membresía pendiente del mismo cliente da 23505", async () => {
      await enRollback(base, async (tx) => {
        const u = await usuarioNuevo(tx);
        expect(await intentar(tx, membresias, pendiente(u))).toBe("ok");
        expect(await intentar(tx, membresias, pendiente(u))).toBe("23505");
      });
    });

    it("una pendiente convive con una activa del mismo cliente (la renovación)", async () => {
      await enRollback(base, async (tx) => {
        const u = await usuarioNuevo(tx);
        expect(await intentar(tx, membresias, activa(u))).toBe("ok");
        expect(await intentar(tx, membresias, pendiente(u))).toBe("ok");
      });
    });
  });

  describe("pagos", () => {
    const valido = (d: Dueno) => ({
      usuarioId: d.usuarioId,
      concepto: "membresia" as const,
      membresiaId: d.membresiaId,
      monto: 26700,
      metodo: "yape" as const,
      comprobanteRuta: `comprobantes/${d.usuarioId}/x.jpg`,
    });

    it("un pago válido queda pendiente por defecto", async () => {
      await enRollback(base, async (tx) => {
        const d = dueno();
        const [p] = await tx.insert(pagos).values(valido(d)).returning();
        expect(p.estado).toBe("pendiente");
        expect(p.revisadoPor).toBeNull();
        expect(p.revisadoEn).toBeNull();
      });
    });

    it.each([
      ["concepto membresía sin membresia_id", (d: Dueno) => ({ ...valido(d), membresiaId: null })],
      ["concepto membresia_y_reserva sin membresia_id", (d: Dueno) => ({ ...valido(d), concepto: "membresia_y_reserva" as const, membresiaId: null })],
      ["Yape sin comprobante", (d: Dueno) => ({ ...valido(d), comprobanteRuta: null })],
      ["transferencia sin comprobante", (d: Dueno) => ({ ...valido(d), metodo: "transferencia" as const, comprobanteRuta: null })],
      ["crédito con monto", (d: Dueno) => ({ ...valido(d), metodo: "credito" as const, comprobanteRuta: null, monto: 100 })],
      ["monto negativo", (d: Dueno) => ({ ...valido(d), monto: -1 })],
    ])("rechaza %s con 23514", async (_nombre, construir) => {
      await enRollback(base, async (tx) => {
        expect(await intentar(tx, pagos, construir(dueno()))).toBe("23514");
      });
    });

    it("un pago de reserva con crédito, sin membresía ni comprobante y monto 0, es válido", async () => {
      await enRollback(base, async (tx) => {
        const d = dueno();
        const pago = { usuarioId: d.usuarioId, concepto: "reserva" as const, monto: 0, metodo: "credito" as const };
        expect(await intentar(tx, pagos, pago)).toBe("ok");
      });
    });
  });

  describe("vínculo de las reservas con su membresía y su pago", () => {
    it("una reserva sin membresía o sin pago da 23502", async () => {
      await enRollback(base, async (tx) => {
        const d = dueno();
        expect(await intentar(tx, reservas, { ...reserva(d), membresiaId: undefined })).toBe("23502");
        expect(await intentar(tx, reservas, { ...reserva(d), pagoId: undefined })).toBe("23502");
      });
    });

    it("una reserva con una membresía o un pago que no existen da 23503", async () => {
      await enRollback(base, async (tx) => {
        const d = dueno();
        const inexistente = "00000000-0000-4000-8000-000000000000";
        expect(await intentar(tx, reservas, reserva({ ...d, membresiaId: inexistente }))).toBe("23503");
        expect(await intentar(tx, reservas, reserva({ ...d, pagoId: inexistente }))).toBe("23503");
      });
    });

    it("dos reservas vivas del mismo pago dan 23505", async () => {
      await enRollback(base, async (tx) => {
        const a = dueno();
        const b = dueno();
        expect(await intentar(tx, reservas, reserva(a, { estado: "confirmada" }))).toBe("ok");
        // Otro cliente, otro horario, el mismo pago: solo el índice por pago lo impide.
        expect(await intentar(tx, reservas, reserva({ ...b, pagoId: a.pagoId }, { estado: "confirmada" }, "2099-07-07T10:00:00-05:00"))).toBe("23505");
      });
    });

    it.each(["expirada", "cancelada"] as const)("el pago de una reserva %s se puede reutilizar", async (estado) => {
      await enRollback(base, async (tx) => {
        const a = dueno();
        expect(await intentar(tx, reservas, reserva(a, { estado }))).toBe("ok");
        expect(await intentar(tx, reservas, reserva(a, { estado: "pendiente" }, "2099-07-07T10:00:00-05:00"))).toBe("ok");
      });
    });

    it("dos reservas pendientes del mismo cliente dan 23505", async () => {
      await enRollback(base, async (tx) => {
        const a = dueno();
        const b = dueno();
        expect(await intentar(tx, reservas, reserva(a, { estado: "pendiente" }))).toBe("ok");
        expect(await intentar(tx, reservas, reserva({ ...b, usuarioId: a.usuarioId }, { estado: "pendiente" }, "2099-07-07T10:00:00-05:00"))).toBe("23505");
      });
    });

    it("una pendiente convive con una confirmada del mismo cliente", async () => {
      await enRollback(base, async (tx) => {
        const a = dueno();
        const b = dueno();
        expect(await intentar(tx, reservas, reserva(a, { estado: "confirmada" }))).toBe("ok");
        expect(await intentar(tx, reservas, reserva({ ...b, usuarioId: a.usuarioId }, { estado: "pendiente" }, "2099-07-07T10:00:00-05:00"))).toBe("ok");
      });
    });

    it("la restricción de exclusión por equipo sigue vigente", async () => {
      await enRollback(base, async (tx) => {
        expect(await intentar(tx, reservas, reserva(dueno(), { estado: "confirmada" }))).toBe("ok");
        expect(await intentar(tx, reservas, reserva(dueno(), { estado: "confirmada" }))).toBe("23P01");
      });
    });
  });
});
