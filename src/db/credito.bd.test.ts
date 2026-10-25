import { and, eq, inArray, sql } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "@/lib/__fixtures__/configuracion";
import { ejecutarPasadaDeExpiracion } from "@/lib/agenda/pasada";
import { instanteLocal } from "@/lib/agenda/horario";
import { transaccionDeEscritura } from "@/lib/agenda/expirar";
import { cancelarConCredito, consumirCreditoDeReservas } from "@/lib/creditos/transiciones";
import { crearRutaCreditos, crearRutaCreditosAdmin } from "@/lib/creditos/rutas";
import { ErrorApi } from "@/lib/errores";
import { aprobarPago, rechazarPago, type DependenciasRevision } from "@/lib/pagos/revision";
import { completarReserva } from "@/lib/admin/reservas/completar";
import { cancelarReservaComoAdmin } from "@/lib/reservas/cancelar-admin";
import { cancelarReservaDelCliente, type DependenciasCancelar } from "@/lib/reservas/cancelar";
import { crearReservaDeMiembro, type DependenciasMiembro } from "@/lib/reservas/miembro";
import { crearReservaDeNuevoHorario, type DependenciasNuevoHorario } from "@/lib/reservas/nuevo-horario";
import { reprogramarReserva, type DependenciasReprogramar } from "@/lib/reservas/reprogramar";
import { requerirAdmin } from "@/lib/sesion";
import type { Usuario } from "@/lib/sesion";
import { creditosHoras, pagos, reservas, usosCredito } from "./esquema";
import { PRUEBAS_BD_ACTIVAS, contarRastros, crearBasePruebas, crearEscenario, enRollback, filaReserva, type BasePruebas } from "./pruebas-bd";

// Crédito en horas contra la rama `pruebas` de Neon (change credito-en-horas, tareas 7.1 a 7.8). Corre con PRUEBAS_BD=1 y
// DATABASE_URL_PRUEBAS. Usuarios `prueba-credito-*@tiza.test`, equipos de prueba INACTIVOS, fechas lejanas (2096 a 2099) y
// limpieza en `afterAll` con comprobación de que no queda nada. El reloj de los vencimientos (`vence_en > now()`) es el de la base.
const AHORA = instanteLocal("2099-01-05", "10:00", "America/Lima"); // lunes
const PREFIJOS = { usuario: "prueba-credito-", equipo: "PRUEBA-credito-" };
const VENCE_LEJOS = new Date("2099-06-01T15:00:00Z");

// Un día distinto para cada reserva (lunes a sábado desde el 12 de enero de 2099, antes del fin de las membresías de prueba).
const DIAS: string[] = [];
for (let t = Date.UTC(2099, 0, 12); DIAS.length < 90; t += 86_400_000) {
  if (new Date(t).getUTCDay() !== 0) DIAS.push(new Date(t).toISOString().slice(0, 10));
}
let siguienteDia = 0;
const nuevoDia = () => DIAS[siguienteDia++];
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown) => Number(v);

describe.skipIf(!PRUEBAS_BD_ACTIVAS)("crédito en horas (Neon)", () => {
  let ctx: ReturnType<typeof crearBasePruebas>;
  let base: BasePruebas;
  let esc: Awaited<ReturnType<typeof crearEscenario>>;
  let admin: { id: string };
  let numeroDeCasa = 700;
  const usuariosDePrueba: string[] = [];

  beforeAll(async () => {
    ctx = crearBasePruebas();
    base = ctx.base;
    esc = await crearEscenario(base, PREFIJOS);
    admin = await esc.crearAdmin();
  });

  afterAll(async () => {
    await esc?.limpiar();
    if (base) expect(await contarRastros(base, PREFIJOS)).toBe(0);
    await ctx?.cerrar();
  });

  // --- Dependencias contra la rama (nunca la base de producción) ---
  const dosEquipos = () => esc.equipoIds.slice(0, 2);
  const depsMiembro = (usuario: Usuario, extra: Partial<DependenciasMiembro> = {}): DependenciasMiembro => ({
    leerConfig: async () => VALORES_DEL_DISENO,
    verificarImagen: async () => ({ ruta: `comprobantes/${usuario.id}/bd.jpg`, tipo: "image/jpeg", tamano: 1000 }),
    base: () => base,
    equipoIds: dosEquipos(),
    numeroWhatsapp: () => null,
    ...extra,
  });
  const depsRevision: DependenciasRevision = { base: () => base, leerConfig: async () => VALORES_DEL_DISENO };
  const depsCancelar: DependenciasCancelar = { base: () => base, leerConfig: async () => VALORES_DEL_DISENO, numeroWhatsapp: () => null };
  const depsNuevoHorario: DependenciasNuevoHorario = { base: () => base, leerConfig: async () => VALORES_DEL_DISENO, numeroWhatsapp: () => null, equipoIds: undefined };
  const depsReprogramar: DependenciasReprogramar = { base: () => base, leerConfig: async () => VALORES_DEL_DISENO, numeroWhatsapp: () => null, equipoIds: undefined };

  const reservarMiembro = (usuario: Usuario, c: unknown) => crearReservaDeMiembro({ usuario, cuerpo: c, ahora: AHORA }, depsMiembro(usuario));
  const aprobar = (pagoId: string) => aprobarPago({ admin, pagoId }, depsRevision);
  const rechazar = (pagoId: string) => rechazarPago({ admin, pagoId }, depsRevision);
  const cancelar = (usuario: Usuario, reservaId: string) => cancelarReservaDelCliente({ usuario, reservaId, ahora: AHORA }, depsCancelar);
  const nuevoHorario = (usuario: Usuario, pagoId: string, inicio: string) =>
    crearReservaDeNuevoHorario({ usuario, pagoId, cuerpo: { inicio }, ahora: AHORA }, { ...depsNuevoHorario, equipoIds: dosEquipos() });

  const error = async (promesa: Promise<unknown>) => {
    try {
      await promesa;
    } catch (e) {
      return e as ErrorApi;
    }
    throw new Error("se esperaba un error");
  };

  const direccionNueva = () => ({ distrito: "Miraflores", calle: "Av. Credito Prueba", numero: String(numeroDeCasa++) });
  const cuerpo = (dia: string, extra: Record<string, unknown> = {}, hora = "10:00") => ({
    servicio: { tipo: "estandar", dormitorios: 2, banos: 1 }, // 4 h, S/ 129
    inicio: `${dia}T${hora}:00-05:00`,
    direccion: direccionNueva(),
    metodo: "yape",
    comprobante: "comprobante-de-prueba",
    ...extra,
  });
  const sinComprobante = (c: Record<string, unknown>) => {
    const { comprobante: _c, metodo: _m, ...resto } = c;
    return resto;
  };

  // Un miembro activo (membresía `activa` hasta 2099-04-30) SIN reservas: su primera limpieza recibiría las 3 horas gratis.
  async function miembroNuevo() {
    const [m] = await esc.crearMiembros(1);
    usuariosDePrueba.push(m.usuario.id);
    return { usuario: m.usuario, usuarioId: m.usuario.id, membresiaId: m.membresiaId };
  }
  // Un miembro que ya tuvo su limpieza (completada, en 2096): paga la limpieza completa con descuento y sin horas gratis.
  async function miembroSinGratis() {
    const m = await miembroNuevo();
    await esc.crearReservaDePrueba(m, { estado: "completada", estadoPago: "aprobado" });
    return m;
  }

  const reservaDe = async (id: string) => (await base.select().from(reservas).where(eq(reservas.id, id)))[0];
  const pagoDe = async (id: string) => (await base.select().from(pagos).where(eq(pagos.id, id)))[0];
  const loteDe = async (id: string) => (await base.select().from(creditosHoras).where(eq(creditosHoras.id, id)))[0];
  const lotesDe = (usuarioId: string) => base.select().from(creditosHoras).where(eq(creditosHoras.usuarioId, usuarioId));
  const usosDeReserva = (reservaId: string) => base.select().from(usosCredito).where(eq(usosCredito.reservaDestinoId, reservaId));
  const loteDeOrigen = async (reservaId: string) => (await base.select().from(creditosHoras).where(eq(creditosHoras.reservaOrigenId, reservaId)))[0];

  // Invariante por lote: horas_disponibles + usos vivos (reservado y consumido) = horas_iniciales.
  async function invariante(usuarioId: string) {
    for (const l of await lotesDe(usuarioId)) {
      const usos = await base.select().from(usosCredito).where(eq(usosCredito.creditoId, l.id));
      const vivos = usos.filter((u) => u.estado !== "devuelto").reduce((s, u) => s + num(u.horas), 0);
      expect(num(l.horasDisponibles) + vivos).toBe(num(l.horasIniciales));
      expect(num(l.horasDisponibles)).toBeGreaterThanOrEqual(0);
    }
  }
  // `vence_en` = `cancelada_en` + 3 meses, calculado por la base.
  const venceTresMesesDespues = async (reservaOrigenId: string) => {
    const r = await base.execute(
      sql`SELECT (c.vence_en = r.cancelada_en + make_interval(months => 3)) AS ok FROM creditos_horas c JOIN reservas r ON r.id = c.reserva_origen_id WHERE c.reserva_origen_id = ${reservaOrigenId}`,
    );
    return (r.rows[0] as { ok: boolean }).ok;
  };
  const venceReserva = (reservaId: string) => base.update(reservas).set({ expiraEn: sql`now() - interval '1 hour'` }).where(eq(reservas.id, reservaId));

  // Ocupa un equipo en un rango con una reserva de otro cliente (con su membresía y pago de prueba).
  async function ocupar(equipoId: number, dia: string, hora: string, horas: number) {
    const [d] = await esc.crearDuenos(1);
    await base.insert(reservas).values(filaReserva({ ...d, equipoId, inicio: `${dia}T${hora}:00-05:00`, horasAgenda: horas, estado: "confirmada" }));
  }

  // ---------------------------------------------------------------------------------------------------------------
  describe("7.1 esquema", () => {
    it("el CHECK rechaza 0 horas iniciales, disponibles mayores que las iniciales y 1,25 horas; el índice único rechaza un segundo lote por la misma reserva", async () => {
      const m = await miembroNuevo();
      const origen = await esc.crearReservaDePrueba(m, { estado: "cancelada", estadoPago: "aprobado", adminId: admin.id });
      await enRollback(base, async (tx) => {
        const intentar = async (valores: Partial<typeof creditosHoras.$inferInsert>) => {
          try {
            await tx.transaction(async (sp) => {
              await sp.insert(creditosHoras).values({ usuarioId: m.usuarioId, reservaOrigenId: origen.reservaId, horasIniciales: "4", horasDisponibles: "4", venceEn: VENCE_LEJOS, ...valores });
            });
            return "ok";
          } catch (e) {
            const x = e as { code?: string; cause?: { code?: string } };
            return x.cause?.code ?? x.code ?? "error";
          }
        };
        expect(await intentar({ horasIniciales: "0", horasDisponibles: "0" })).toBe("23514");
        expect(await intentar({ horasIniciales: "2", horasDisponibles: "3" })).toBe("23514");
        expect(await intentar({ horasIniciales: "1.25", horasDisponibles: "1.25" })).toBe("23514");
        expect(await intentar({ horasIniciales: "4", horasDisponibles: "-1" })).toBe("23514");
        expect(await intentar({})).toBe("ok");
        expect(await intentar({})).toBe("23505"); // un lote por reserva de origen
      });
    });

    it("cancelada_en solo se permite en una reserva cancelada", async () => {
      const m = await miembroNuevo();
      const r = await esc.crearReservaDePrueba(m, { estado: "confirmada", estadoPago: "aprobado", adminId: admin.id });
      await enRollback(base, async (tx) => {
        let codigo = "ok";
        try {
          await tx.transaction(async (sp) => {
            await sp.update(reservas).set({ canceladaEn: new Date() }).where(eq(reservas.id, r.reservaId));
          });
        } catch (e) {
          const x = e as { code?: string; cause?: { code?: string } };
          codigo = x.cause?.code ?? x.code ?? "error";
        }
        expect(codigo).toBe("23514");
      });
    });

    it("un solo uso por lote y reserva de destino", async () => {
      const m = await miembroNuevo();
      const lote = await esc.crearLote(m, { horas: 4 });
      const destino = await esc.crearReservaDePrueba(m, { estado: "confirmada", estadoPago: "aprobado" });
      await base.update(creditosHoras).set({ horasDisponibles: "2" }).where(eq(creditosHoras.id, lote.loteId));
      await base.insert(usosCredito).values({ creditoId: lote.loteId, reservaDestinoId: destino.reservaId, horas: "2", estado: "consumido" });
      await enRollback(base, async (tx) => {
        let codigo = "ok";
        try {
          await tx.transaction(async (sp) => {
            await sp.insert(usosCredito).values({ creditoId: lote.loteId, reservaDestinoId: destino.reservaId, horas: "1", estado: "reservado" });
          });
        } catch (e) {
          const x = e as { code?: string; cause?: { code?: string } };
          codigo = x.cause?.code ?? x.code ?? "error";
        }
        expect(codigo).toBe("23505");
      });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("7.2 generación", () => {
    it("cancelar con el pago aprobado crea el lote de 4 h con vence_en a 3 meses de cancelada_en", async () => {
      const m = await miembroSinGratis();
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      await aprobar(r.pago.id);
      const c = await cancelar(m.usuario, r.reserva.id);
      expect(c.credito).toMatchObject({ generado_horas: 4, devuelto_horas: 0 });
      expect(c.credito.vence_en).not.toBeNull();
      const lote = await loteDeOrigen(r.reserva.id);
      expect(lote).toMatchObject({ usuarioId: m.usuarioId });
      expect(num(lote.horasIniciales)).toBe(4);
      expect(num(lote.horasDisponibles)).toBe(4);
      expect(await venceTresMesesDespues(r.reserva.id)).toBe(true);
      expect((await reservaDe(r.reserva.id)).canceladaEn).not.toBeNull();
      await invariante(m.usuarioId);
    });

    it("con el pago pendiente no hay lote; al aprobarlo después aparece con el vencimiento de la CANCELACIÓN", async () => {
      const m = await miembroSinGratis();
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      const c = await cancelar(m.usuario, r.reserva.id);
      expect(c.credito.generado_horas).toBe(0);
      expect(await loteDeOrigen(r.reserva.id)).toBeUndefined();
      await esperar(1200); // la aprobación ocurre claramente después de la cancelación
      const a = await aprobar(r.pago.id);
      expect(a.credito_generado).toMatchObject({ horas: 4 });
      const lote = await loteDeOrigen(r.reserva.id);
      expect(num(lote.horasIniciales)).toBe(4);
      expect(await venceTresMesesDespues(r.reserva.id)).toBe(true);
      const cancelada = (await reservaDe(r.reserva.id)).canceladaEn!;
      expect(lote.creadoEn.getTime()).toBeGreaterThan(cancelada.getTime());
    });

    it("con el pago rechazado no hay lote", async () => {
      const m = await miembroSinGratis();
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      await rechazar(r.pago.id);
      await cancelar(m.usuario, r.reserva.id);
      expect(await loteDeOrigen(r.reserva.id)).toBeUndefined();
    });

    it("cancelada por el administrador no genera lote, ni aunque se apruebe el pago después", async () => {
      const m = await miembroSinGratis();
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      await cancelarReservaComoAdmin({ reservaId: r.reserva.id }, { base: () => base });
      await aprobar(r.pago.id);
      expect(await loteDeOrigen(r.reserva.id)).toBeUndefined();
      expect((await reservaDe(r.reserva.id)).canceladaPor).toBe("admin");
    });

    it("primera de 5 h con 3 gratis genera 2 h; primera de 3 h no genera", async () => {
      const a = await miembroNuevo();
      const cinco = await reservarMiembro(a.usuario, { ...cuerpo(nuevoDia()), servicio: { tipo: "profunda", dormitorios: 2, banos: 1 } });
      expect(cinco.reserva).toMatchObject({ horas_gratis_aplicadas: 3, monto: 6966 });
      await aprobar(cinco.pago.id);
      const c5 = await cancelar(a.usuario, cinco.reserva.id);
      expect(c5.credito.generado_horas).toBe(2);
      expect(num((await loteDeOrigen(cinco.reserva.id)).horasIniciales)).toBe(2);

      const b = await miembroNuevo();
      const tres = await reservarMiembro(b.usuario, { ...sinComprobante(cuerpo(nuevoDia())), servicio: { tipo: "estandar", dormitorios: 1, banos: 1 } });
      expect(tres.reserva).toMatchObject({ estado: "confirmada", monto: 0 });
      const c3 = await cancelar(b.usuario, tres.reserva.id);
      expect(c3.credito.generado_horas).toBe(0);
      expect(c3.limpieza_gratis_conservada).toBe(true);
      expect(await loteDeOrigen(tres.reserva.id)).toBeUndefined();
    });

    it("pagada en parte con crédito: devuelve las horas al lote original (mismo vence_en) y genera solo lo pagado en dinero", async () => {
      const m = await miembroSinGratis();
      const original = await esc.crearLote(m, { horas: 2, venceEn: VENCE_LEJOS });
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      expect(r.reserva).toMatchObject({ estado: "pendiente", monto: 5805 });
      expect(num((await loteDe(original.loteId)).horasDisponibles)).toBe(0);
      await aprobar(r.pago.id);
      const c = await cancelar(m.usuario, r.reserva.id);
      expect(c.credito).toMatchObject({ generado_horas: 2, devuelto_horas: 2 });
      const devuelto = await loteDe(original.loteId);
      expect(num(devuelto.horasDisponibles)).toBe(2);
      expect(devuelto.venceEn.getTime()).toBe(VENCE_LEJOS.getTime());
      expect(num((await loteDeOrigen(r.reserva.id)).horasIniciales)).toBe(2);
      expect((await usosDeReserva(r.reserva.id)).every((u) => u.estado === "devuelto")).toBe(true);
      await invariante(m.usuarioId);
    });

    it("cubierta por crédito: cancelar solo devuelve y no genera un lote nuevo", async () => {
      const m = await miembroSinGratis();
      const original = await esc.crearLote(m, { horas: 4, venceEn: VENCE_LEJOS });
      const r = await reservarMiembro(m.usuario, sinComprobante(cuerpo(nuevoDia())));
      expect(r.reserva).toMatchObject({ estado: "confirmada", monto: 0 });
      const c = await cancelar(m.usuario, r.reserva.id);
      expect(c.credito).toMatchObject({ generado_horas: 0, devuelto_horas: 4 });
      expect(num((await loteDe(original.loteId)).horasDisponibles)).toBe(4);
      expect(await loteDeOrigen(r.reserva.id)).toBeUndefined();
      await invariante(m.usuarioId);
    });

    it("cancelar dos veces no duplica el lote", async () => {
      const m = await miembroSinGratis();
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      await aprobar(r.pago.id);
      await cancelar(m.usuario, r.reserva.id);
      const segunda = await cancelar(m.usuario, r.reserva.id);
      expect(segunda.credito).toMatchObject({ generado_horas: 0, devuelto_horas: 0 });
      expect((await lotesDe(m.usuarioId)).filter((l) => l.reservaOrigenId === r.reserva.id)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("7.3 carreras de generación", () => {
    const limite = <T>(p: Promise<T>, ms = 30_000) => Promise.race([p, esperar(ms).then(() => Promise.reject(new Error("tiempo agotado: posible interbloqueo")))]);

    it("cancelar primero (con una puerta) y aprobar a la vez dejan exactamente un lote", async () => {
      const m = await miembroSinGratis();
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      let liberar!: () => void;
      let marcar!: () => void;
      const puerta = new Promise<void>((res) => (liberar = res));
      const bloqueada = new Promise<void>((res) => (marcar = res));
      // La cancelación bloquea la reserva y la deja `cancelada` (con `cancelada_en`, en el mismo UPDATE); espera la puerta antes de generar.
      const cancelacion = base.transaction(async (tx) => {
        const [fila] = await tx.select().from(reservas).where(eq(reservas.id, r.reserva.id)).for("update");
        await tx.update(reservas).set({ estado: "cancelada", canceladaPor: "cliente", canceladaEn: sql`now()`, expiraEn: null, actualizadaEn: sql`now()` }).where(eq(reservas.id, r.reserva.id));
        marcar();
        await puerta;
        await cancelarConCredito(tx, fila, 3);
      });
      await bloqueada;
      const aprobacion = aprobar(r.pago.id);
      aprobacion.catch(() => undefined);
      await esperar(600); // la aprobación queda esperando el bloqueo de la reserva
      liberar();
      await limite(Promise.all([cancelacion, aprobacion]));
      expect((await lotesDe(m.usuarioId)).filter((l) => l.reservaOrigenId === r.reserva.id)).toHaveLength(1);
      expect((await pagoDe(r.pago.id)).estado).toBe("aprobado");
      expect((await reservaDe(r.reserva.id)).estado).toBe("cancelada");
      await invariante(m.usuarioId);
    });

    it("aprobar primero (con una puerta) y cancelar a la vez dejan exactamente un lote", async () => {
      const m = await miembroSinGratis();
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      let liberar!: () => void;
      let marcar!: () => void;
      const puerta = new Promise<void>((res) => (liberar = res));
      const bloqueada = new Promise<void>((res) => (marcar = res));
      const aprobacion = base.transaction(async (tx) => {
        await tx.select().from(pagos).where(eq(pagos.id, r.pago.id)).for("update");
        await tx.update(pagos).set({ estado: "aprobado", revisadoPor: admin.id, revisadoEn: sql`now()` }).where(eq(pagos.id, r.pago.id));
        await tx.update(reservas).set({ estado: "confirmada", expiraEn: null }).where(and(eq(reservas.pagoId, r.pago.id), eq(reservas.estado, "pendiente")));
        marcar();
        await puerta;
        await consumirCreditoDeReservas(tx, [r.reserva.id]);
      });
      await bloqueada;
      const cancelacion = cancelar(m.usuario, r.reserva.id);
      cancelacion.catch(() => undefined);
      await esperar(600);
      liberar();
      await limite(Promise.all([aprobacion, cancelacion]));
      expect((await lotesDe(m.usuarioId)).filter((l) => l.reservaOrigenId === r.reserva.id)).toHaveLength(1);
      expect((await reservaDe(r.reserva.id)).estado).toBe("cancelada");
      await invariante(m.usuarioId);
    });

    it("la cancelación no toma bloqueo sobre el pago: termina aunque otra transacción lo tenga bloqueado", async () => {
      const m = await miembroSinGratis();
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      let liberar!: () => void;
      let marcar!: () => void;
      const puerta = new Promise<void>((res) => (liberar = res));
      const bloqueada = new Promise<void>((res) => (marcar = res));
      const sostiene = base.transaction(async (tx) => {
        await tx.select().from(pagos).where(eq(pagos.id, r.pago.id)).for("update");
        marcar();
        await puerta;
      });
      await bloqueada;
      const cancelacion = cancelar(m.usuario, r.reserva.id);
      cancelacion.catch(() => undefined);
      try {
        const resultado = await Promise.race([cancelacion, esperar(30_000).then(() => "bloqueada" as const)]);
        expect(resultado).not.toBe("bloqueada");
      } finally {
        liberar(); // siempre se libera la puerta: si no, la limpieza de la suite quedaría esperando este bloqueo
      }
      await sostiene;
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("7.4 aplicación al reservar", () => {
    it("usa primero el lote que vence antes", async () => {
      const m = await miembroSinGratis();
      const tarde = await esc.crearLote(m, { horas: 2, venceEn: new Date("2099-08-01T15:00:00Z") });
      const pronto = await esc.crearLote(m, { horas: 2, venceEn: new Date("2099-05-01T15:00:00Z") });
      const r = await reservarMiembro(m.usuario, { ...cuerpo(nuevoDia()), servicio: { tipo: "paquete", horas: 3 } });
      const usos = await usosDeReserva(r.reserva.id);
      const deLote = (id: string) => num(usos.find((u) => u.creditoId === id)?.horas ?? 0);
      expect(deLote(pronto.loteId)).toBe(2);
      expect(deLote(tarde.loteId)).toBe(1);
      expect(num((await loteDe(pronto.loteId)).horasDisponibles)).toBe(0);
      expect(num((await loteDe(tarde.loteId)).horasDisponibles)).toBe(1);
      await invariante(m.usuarioId);
    });

    it("las horas gratis van primero y el crédito cubre el resto: cubierta, confirmada y con pago interno de monto 0", async () => {
      const m = await miembroNuevo(); // primera limpieza: 3 horas gratis
      const lote = await esc.crearLote(m, { horas: 4 });
      const r = await reservarMiembro(m.usuario, { ...sinComprobante(cuerpo(nuevoDia())), servicio: { tipo: "profunda", dormitorios: 2, banos: 1 } }); // 5 h
      expect(r.reserva).toMatchObject({ estado: "confirmada", monto: 0, horas_gratis_aplicadas: 3 });
      expect(num((await reservaDe(r.reserva.id)).creditoAplicado)).toBe(2);
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(2);
      await invariante(m.usuarioId);
    });

    it("2 horas de crédito en un servicio de 4: la reserva queda pendiente por S/ 58,05 y los usos reservado", async () => {
      const m = await miembroSinGratis();
      await esc.crearLote(m, { horas: 2 });
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      expect(r.reserva).toMatchObject({ estado: "pendiente", monto: 5805 });
      expect(r.pago).toMatchObject({ estado: "pendiente", monto: 5805 });
      expect((await usosDeReserva(r.reserva.id)).map((u) => [num(u.horas), u.estado])).toEqual([[2, "reservado"]]);
    });

    it("cubierta sin comprobante: confirmada, pago interno aprobado de monto 0 y usos consumido", async () => {
      const m = await miembroSinGratis();
      const lote = await esc.crearLote(m, { horas: 4 });
      const r = await reservarMiembro(m.usuario, sinComprobante(cuerpo(nuevoDia())));
      expect(r.reserva).toMatchObject({ estado: "confirmada", monto: 0, expira_en: null });
      const pago = await pagoDe(r.pago.id);
      expect(pago).toMatchObject({ metodo: "credito", monto: 0, estado: "aprobado", comprobanteRuta: null });
      expect((await usosDeReserva(r.reserva.id)).map((u) => [num(u.horas), u.estado])).toEqual([[4, "consumido"]]);
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(0);
    });

    it("un comprobante enviado de más con el crédito cubriendo todo se ignora", async () => {
      const m = await miembroSinGratis();
      await esc.crearLote(m, { horas: 4 });
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      expect((await pagoDe(r.pago.id)).comprobanteRuta).toBeNull();
    });

    it("un lote vencido un minuto antes no se aplica", async () => {
      const m = await miembroSinGratis();
      const lote = await esc.crearLote(m, { horas: 4, venceEn: sql`now() - interval '1 minute'` });
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      expect(r.reserva).toMatchObject({ estado: "pendiente", monto: 11610 });
      expect(num((await reservaDe(r.reserva.id)).creditoAplicado)).toBe(0);
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(4);
    });

    it("un lote que vence entre la creación y el servicio conserva el uso", async () => {
      const m = await miembroSinGratis();
      // Vence en 2099-01-08, antes del servicio (2099-01-12 o después) pero mucho después de `now()` de la base.
      const lote = await esc.crearLote(m, { horas: 4, venceEn: new Date("2099-01-08T15:00:00Z") });
      const r = await reservarMiembro(m.usuario, sinComprobante(cuerpo(nuevoDia())));
      expect(r.reserva.estado).toBe("confirmada");
      const usos = await usosDeReserva(r.reserva.id);
      expect(usos).toHaveLength(1);
      expect(usos[0].estado).toBe("consumido");
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(0);
    });

    it("sin comprobante y con resto por pagar → 422 y los lotes quedan intactos", async () => {
      const m = await miembroSinGratis();
      const lote = await esc.crearLote(m, { horas: 1 });
      const e = await error(reservarMiembro(m.usuario, sinComprobante(cuerpo(nuevoDia()))));
      expect(e).toMatchObject({ status: 422, codigo: "comprobante_requerido" });
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(1);
      expect(await base.select().from(usosCredito).where(eq(usosCredito.creditoId, lote.loteId))).toHaveLength(0);
    });

    it("sin cupo (409) no descuenta", async () => {
      const m = await miembroSinGratis();
      const lote = await esc.crearLote(m, { horas: 4 });
      const dia = nuevoDia();
      await ocupar(esc.equipoIds[0], dia, "10:00", 5);
      await ocupar(esc.equipoIds[1], dia, "10:00", 5);
      const e = await error(reservarMiembro(m.usuario, sinComprobante(cuerpo(dia))));
      expect(e).toMatchObject({ status: 409, codigo: "conflicto" });
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(4);
      expect(await base.select().from(usosCredito).where(eq(usosCredito.creditoId, lote.loteId))).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("7.5 transiciones", () => {
    // Un miembro con un lote de 2 h y una reserva pendiente que lo usa (2 h de crédito + 2 h pagadas).
    async function conReservaParcial() {
      const m = await miembroSinGratis();
      const lote = await esc.crearLote(m, { horas: 2, venceEn: VENCE_LEJOS });
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      return { m, lote, r };
    }

    it("aprobar pasa los usos a consumido", async () => {
      const { m, lote, r } = await conReservaParcial();
      await aprobar(r.pago.id);
      expect((await usosDeReserva(r.reserva.id)).map((u) => u.estado)).toEqual(["consumido"]);
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(0);
      await invariante(m.usuarioId);
    });

    it("una pendiente vencida se marca expirada por OTRA escritura y devuelve las horas al lote original", async () => {
      const { m, lote, r } = await conReservaParcial();
      await venceReserva(r.reserva.id);
      await transaccionDeEscritura(async () => undefined, base);
      expect((await reservaDe(r.reserva.id)).estado).toBe("expirada");
      const devuelto = await loteDe(lote.loteId);
      expect(num(devuelto.horasDisponibles)).toBe(2);
      expect(devuelto.venceEn.getTime()).toBe(VENCE_LEJOS.getTime());
      expect((await usosDeReserva(r.reserva.id)).map((u) => u.estado)).toEqual(["devuelto"]);
      await invariante(m.usuarioId);
    });

    it("la escritura que falla después deshace la devolución y la pasada del administrador la repite", async () => {
      const { m, lote, r } = await conReservaParcial();
      await venceReserva(r.reserva.id);
      await expect(
        transaccionDeEscritura(async () => {
          throw new Error("falla después de expirar");
        }, base),
      ).rejects.toThrow("falla después de expirar");
      expect((await reservaDe(r.reserva.id)).estado).toBe("pendiente");
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(0);
      await ejecutarPasadaDeExpiracion(base, async () => ({ reenvio_comprobante_dias: 7 }));
      expect((await reservaDe(r.reserva.id)).estado).toBe("expirada");
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(2);
      await invariante(m.usuarioId);
    });

    it("rechazar no cambia nada; la devolución ocurre al expirar", async () => {
      const { m, lote, r } = await conReservaParcial();
      await rechazar(r.pago.id);
      expect((await reservaDe(r.reserva.id)).estado).toBe("pendiente");
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(0);
      expect((await usosDeReserva(r.reserva.id)).map((u) => u.estado)).toEqual(["reservado"]);
      await venceReserva(r.reserva.id);
      await transaccionDeEscritura(async () => undefined, base);
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(2);
      await invariante(m.usuarioId);
    });

    it("cancelar como administrador devuelve las horas y no genera lote", async () => {
      const { m, lote, r } = await conReservaParcial();
      await cancelarReservaComoAdmin({ reservaId: r.reserva.id }, { base: () => base });
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(2);
      expect((await reservaDe(r.reserva.id)).canceladaEn).not.toBeNull();
      expect(await loteDeOrigen(r.reserva.id)).toBeUndefined();
      await invariante(m.usuarioId);
    });

    it("completar y reprogramar no cambian los usos", async () => {
      const m = await miembroSinGratis();
      const lote = await esc.crearLote(m, { horas: 4, venceEn: VENCE_LEJOS });
      const r = await reservarMiembro(m.usuario, sinComprobante(cuerpo(nuevoDia()))); // cubierta: confirmada, uso consumido
      const antes = await usosDeReserva(r.reserva.id);
      await reprogramarReserva({ usuario: m.usuario, reservaId: r.reserva.id, cuerpo: { inicio: `${nuevoDia()}T14:00:00-05:00` }, ahora: AHORA }, { ...depsReprogramar, equipoIds: dosEquipos() });
      expect(await usosDeReserva(r.reserva.id)).toEqual(antes);
      // Completar exige que el servicio ya haya empezado: se adelanta con una reserva del pasado y el mismo uso.
      const pasada = await esc.crearReservaDePrueba(m, { estado: "confirmada", estadoPago: "aprobado" });
      await base.update(reservas).set({ inicio: sql`now() - interval '3 hours'`, fin: sql`now() - interval '1 hour'`, finBloqueo: sql`now()` }).where(eq(reservas.id, pasada.reservaId));
      // Un lote aparte con 3 de 4 h disponibles y esa hora ya consumida por la reserva del pasado (invariante intacto).
      const otro = await esc.crearLote(m, { horas: 4, disponibles: 3, venceEn: VENCE_LEJOS });
      await base.insert(usosCredito).values({ creditoId: otro.loteId, reservaDestinoId: pasada.reservaId, horas: "1", estado: "consumido" });
      await completarReserva({ reservaId: pasada.reservaId }, { base: () => base });
      expect((await usosDeReserva(pasada.reservaId)).map((u) => u.estado)).toEqual(["consumido"]);
      expect(num((await loteDe(otro.loteId)).horasDisponibles)).toBe(3);
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(0);
      await invariante(m.usuarioId);
    });

    it("aprobación tardía no toca los lotes y el nuevo horario vuelve a tomar el crédito", async () => {
      const m = await miembroSinGratis();
      const lote = await esc.crearLote(m, { horas: 2, venceEn: VENCE_LEJOS });
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      await venceReserva(r.reserva.id);
      await transaccionDeEscritura(async () => undefined, base); // expira y devuelve
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(2);
      const a = await aprobar(r.pago.id); // aprobación tardía
      expect(a.nuevo_horario_pendiente).toBe(true);
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(2);
      const nuevo = await nuevoHorario(m.usuario, r.pago.id, `${nuevoDia()}T10:00:00-05:00`);
      expect(nuevo.credito_faltante_horas).toBe(0);
      expect(nuevo.reserva.estado).toBe("confirmada");
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(0);
      expect((await usosDeReserva(nuevo.reserva.id)).map((u) => [num(u.horas), u.estado])).toEqual([[2, "consumido"]]);
      await invariante(m.usuarioId);
    });

    it("aprobación tardía con el crédito ya gastado: la reserva se crea igual y el faltante se informa", async () => {
      const m = await miembroSinGratis();
      const lote = await esc.crearLote(m, { horas: 2, venceEn: VENCE_LEJOS });
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      await venceReserva(r.reserva.id);
      await transaccionDeEscritura(async () => undefined, base);
      // Mientras tanto el cliente gasta ese crédito en otra limpieza (cubierta de 2 h con un paquete de 3: 2 h de crédito + 1 h por pagar).
      const otra = await reservarMiembro(m.usuario, { ...cuerpo(nuevoDia()), servicio: { tipo: "paquete", horas: 3 } });
      expect(num((await reservaDe(otra.reserva.id)).creditoAplicado)).toBe(2);
      await aprobar(r.pago.id);
      await aprobar(otra.pago.id);
      const nuevo = await nuevoHorario(m.usuario, r.pago.id, `${nuevoDia()}T10:00:00-05:00`);
      expect(nuevo.reserva.estado).toBe("confirmada");
      expect(nuevo.credito_faltante_horas).toBe(2);
      expect(await usosDeReserva(nuevo.reserva.id)).toHaveLength(0);
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(0);
      await invariante(m.usuarioId);
    });

    it("recuperar cancelaciones anteriores: la sentencia de la migración crea los lotes esperados y una segunda ejecución no crea más", async () => {
      const m = await miembroNuevo();
      const carpeta = new URL("./migraciones/", import.meta.url);
      const archivo = readdirSync(carpeta).find((n) => n.endsWith("_credito-en-horas.sql"))!;
      const texto = readFileSync(new URL(archivo, carpeta), "utf8");
      const sentencia = texto
        .slice(texto.indexOf("-- recuperar-creditos"))
        .split("\n")
        .filter((l) => !l.startsWith("--"))
        .join("\n");
      // Filas insertadas a mano: dos canceladas por el cliente con pago aprobado (una con 4 h, otra con 1,5 h de crédito
      // aplicado), una con pago pendiente, una cancelada por el administrador y una sin horas pagadas.
      const aprobada = await esc.crearReservaDePrueba(m, { estado: "cancelada", estadoPago: "aprobado", adminId: admin.id });
      const parcial = await esc.crearReservaDePrueba(m, { estado: "cancelada", estadoPago: "aprobado", adminId: admin.id, credito: 1.5 });
      const pendiente = await esc.crearReservaDePrueba(m, { estado: "cancelada", estadoPago: "pendiente" });
      const porAdmin = await esc.crearReservaDePrueba(m, { estado: "cancelada", estadoPago: "aprobado", adminId: admin.id, canceladaPor: "admin" });
      const gratis = await esc.crearReservaDePrueba(m, { estado: "cancelada", estadoPago: "aprobado", adminId: admin.id, gratis: 4 });
      await base.execute(sql.raw(sentencia));
      const ids = [aprobada, parcial, pendiente, porAdmin, gratis].map((x) => x.reservaId);
      const tras = await base.select().from(creditosHoras).where(inArray(creditosHoras.reservaOrigenId, ids));
      const de = (id: string) => tras.find((l) => l.reservaOrigenId === id);
      expect(num(de(aprobada.reservaId)!.horasIniciales)).toBe(4);
      expect(num(de(parcial.reservaId)!.horasIniciales)).toBe(2.5);
      expect(de(pendiente.reservaId)).toBeUndefined();
      expect(de(porAdmin.reservaId)).toBeUndefined();
      expect(de(gratis.reservaId)).toBeUndefined();
      expect(await venceTresMesesDespues(aprobada.reservaId)).toBe(true);
      await base.execute(sql.raw(sentencia));
      const segunda = await base.select().from(creditosHoras).where(inArray(creditosHoras.reservaOrigenId, ids));
      expect(segunda).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("7.6 concurrencia e invariante", () => {
    it("dos reservas simultáneas del mismo cliente sobre un lote de 4 h para servicios de 4 h: una usa las 4 h y la otra no aplica crédito", async () => {
      const m = await miembroSinGratis();
      const lote = await esc.crearLote(m, { horas: 4, venceEn: VENCE_LEJOS });
      const [a, b] = await Promise.all([
        reservarMiembro(m.usuario, cuerpo(nuevoDia())),
        reservarMiembro(m.usuario, cuerpo(nuevoDia())),
      ]);
      const aplicados = [a, b].map((r) => r.reserva.estado);
      expect(aplicados.sort()).toEqual(["confirmada", "pendiente"]);
      const conCredito = [a, b].find((r) => r.reserva.estado === "confirmada")!;
      const sinCredito = [a, b].find((r) => r.reserva.estado === "pendiente")!;
      expect(num((await reservaDe(conCredito.reserva.id)).creditoAplicado)).toBe(4);
      expect(num((await reservaDe(sinCredito.reserva.id)).creditoAplicado)).toBe(0);
      expect(sinCredito.reserva.monto).toBe(11610);
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(0);
      const usos = await base.select().from(usosCredito).where(eq(usosCredito.creditoId, lote.loteId));
      expect(usos.reduce((s, u) => s + num(u.horas), 0)).toBe(4);
      await invariante(m.usuarioId);
    });

    it("dos expiraciones simultáneas de las mismas reservas no devuelven dos veces", async () => {
      const m = await miembroSinGratis();
      const lote = await esc.crearLote(m, { horas: 2, venceEn: VENCE_LEJOS });
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      await venceReserva(r.reserva.id);
      await Promise.all([transaccionDeEscritura(async () => undefined, base), transaccionDeEscritura(async () => undefined, base)]);
      expect((await reservaDe(r.reserva.id)).estado).toBe("expirada");
      expect(num((await loteDe(lote.loteId)).horasDisponibles)).toBe(2);
      await invariante(m.usuarioId);
    });

    it("el invariante se cumple en todos los clientes de esta suite", async () => {
      for (const id of usuariosDePrueba) await invariante(id);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("7.7 lectura", () => {
    const fakeAuth = (u: Usuario) => ({ api: { getSession: async () => ({ user: { id: u.id, email: u.correo, name: u.nombre, telefono: u.celular, rol: u.rol } }) } }) as never;
    const peticion = (url = "http://localhost/api/creditos") => new Request(url);
    const config = async () => VALORES_DEL_DISENO;
    const pasada = () => ejecutarPasadaDeExpiracion(base, async () => ({ reenvio_comprobante_dias: 7 }));

    it("GET /api/creditos de A no trae nada de B y el saldo excluye los lotes vencidos", async () => {
      const a = await miembroNuevo();
      const b = await miembroNuevo();
      const vigente = await esc.crearLote(a, { horas: 3, venceEn: VENCE_LEJOS });
      const pronto = await esc.crearLote(a, { horas: 2, venceEn: new Date("2099-03-01T15:00:00Z") });
      const vencido = await esc.crearLote(a, { horas: 2, venceEn: sql`now() - interval '1 minute'` });
      await esc.crearLote(b, { horas: 4, venceEn: VENCE_LEJOS });
      const rutaDe = (u: Usuario) => crearRutaCreditos({ sesion: async () => u, base: () => base, leerConfig: config, pasada });
      const deA = await (await rutaDe(a.usuario)(peticion())).json();
      expect(deA.saldo_horas).toBe(5);
      // El próximo vencimiento es el del lote vigente que vence primero, con sus horas.
      expect(deA.proximo_vencimiento).toEqual({ horas: 2, vence_en: "2099-03-01T10:00:00-05:00" });
      expect(deA.lotes.map((l: { id: string }) => l.id).sort()).toEqual([vigente.loteId, pronto.loteId, vencido.loteId].sort());
      expect(deA.lotes.every((l: { origen: { cancelada_en: string | null } }) => l.origen.cancelada_en !== null)).toBe(true);
      expect(deA.lotes.find((l: { id: string }) => l.id === vencido.loteId).vigente).toBe(false);
      expect(deA.lotes.every((l: { id: string }) => [vigente.loteId, pronto.loteId, vencido.loteId].includes(l.id))).toBe(true);
      const deB = await (await rutaDe(b.usuario)(peticion("http://localhost/api/creditos?usuario_id=" + a.usuarioId))).json();
      expect(deB.saldo_horas).toBe(4);
      expect(deB.lotes).toHaveLength(1);
      expect(deB.movimientos.every((m: { reserva: { id: string } }) => m.reserva.id !== undefined)).toBe(true);
    });

    it("el administrador ve el crédito de cada cliente y un cliente recibe 403 en /api/admin/creditos", async () => {
      const a = await miembroNuevo();
      await esc.crearLote(a, { horas: 3, venceEn: VENCE_LEJOS });
      const adminUsuario: Usuario = { id: admin.id, correo: `${admin.id}@tiza.test`, nombre: "Prueba admin", celular: "900000000", rol: "admin" };
      const rutaAdmin = (u: Usuario) =>
        crearRutaCreditosAdmin({ sesion: (c) => requerirAdmin(c, fakeAuth(u)), base: () => base, leerZona: config, pasada });
      const r = await rutaAdmin(adminUsuario)(peticion("http://localhost/api/admin/creditos"));
      expect(r.status).toBe(200);
      const clientes = (await r.json()).clientes as { usuario_id: string; saldo_horas: number }[];
      expect(clientes.find((c) => c.usuario_id === a.usuarioId)?.saldo_horas).toBe(3);
      const prohibido = await rutaAdmin(a.usuario)(peticion("http://localhost/api/admin/creditos"));
      expect(prohibido.status).toBe(403);
    });
  });
});
