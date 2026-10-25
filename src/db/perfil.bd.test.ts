import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "@/lib/__fixtures__/configuracion";
import { instanteLocal } from "@/lib/agenda/horario";
import { leerOcupacion } from "@/lib/agenda/leer";
import { ErrorApi } from "@/lib/errores";
import { leerDetalleReserva, type DependenciasDetalle } from "@/lib/perfil/detalle";
import { leerPerfil, type DependenciasPerfil } from "@/lib/perfil/resumen";
import { cancelarReservaDelCliente, ErrorFueraDePlazo, type DependenciasCancelar } from "@/lib/reservas/cancelar";
import { crearPrimeraReserva, type DependenciasCrear } from "@/lib/reservas/crear";
import { consultarDisponibilidadDeReserva, type DependenciasDisponibilidadPropia } from "@/lib/reservas/disponibilidad-propia";
import { decidirLimpiezaGratis } from "@/lib/reservas/gratis";
import { reprogramarReserva, type DependenciasReprogramar } from "@/lib/reservas/reprogramar";
import type { Usuario } from "@/lib/sesion";
import { creditosHoras, membresias, pagos, reservas } from "./esquema";
import { PRUEBAS_BD_ACTIVAS, contarRastros, crearBasePruebas, crearEscenario, filaReserva, type BasePruebas, type Dueno } from "./pruebas-bd";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// Perfil del cliente contra la rama `pruebas` de Neon (change perfil-reservas-y-membresia): aislamiento entre clientes,
// cancelar, reprogramar, primera limpieza cancelada y estados de la membresía. Corre con PRUEBAS_BD=1.
// Equipos de prueba INACTIVOS, fechas de 2099 y datos con el prefijo `prueba-agenda-`; todo se borra en afterAll.
const ZONA = "America/Lima";
const AHORA = instanteLocal("2099-01-05", "10:00", ZONA); // lunes
const FIN_MEMBRESIA = new Date("2099-03-30T15:00:00Z");

const DIAS: string[] = [];
for (let t = Date.UTC(2099, 0, 12); DIAS.length < 66; t += 86_400_000) {
  if (new Date(t).getUTCDay() !== 0) DIAS.push(new Date(t).toISOString().slice(0, 10));
}
let siguienteDia = 0;
const nuevoDia = () => DIAS[siguienteDia++];
const a = (dia: string, hora = "10:00") => `${dia}T${hora}:00-05:00`;

describe.skipIf(!PRUEBAS_BD_ACTIVAS)("perfil del cliente (Neon)", () => {
  let ctx: ReturnType<typeof crearBasePruebas>;
  let base: BasePruebas;
  let esc: Awaited<ReturnType<typeof crearEscenario>>;
  let duenos: Dueno[];
  let siguienteDueno = 0;
  let admin: { id: string };

  beforeAll(async () => {
    ctx = crearBasePruebas();
    base = ctx.base;
    esc = await crearEscenario(base);
    duenos = await esc.crearDuenos(60);
    admin = await esc.crearAdmin();
  });

  afterAll(async () => {
    await esc?.limpiar();
    if (base) expect(await contarRastros(base)).toBe(0);
    await ctx?.cerrar();
  });

  const usuarioDe = (id: string): Usuario => ({ id, correo: `${id}@tiza.test`, nombre: "Prueba agenda", celular: "900000000", rol: "cliente" });
  const nuevoDueno = () => duenos[siguienteDueno++];
  const eq0 = () => esc.equipoIds[0];

  // --- preparación -------------------------------------------------------------------------------------------
  async function aprobarPago(d: Dueno) {
    await base.update(pagos).set({ estado: "aprobado", revisadoPor: admin.id, revisadoEn: sql`now()` }).where(eq(pagos.id, d.pagoId));
  }
  async function activarMembresia(d: Dueno, modo: "vigente" | "vencida" | { dias: number } = "vigente") {
    const fechas =
      modo === "vigente"
        ? { inicio: new Date("2098-12-01T15:00:00Z"), fin: FIN_MEMBRESIA }
        : modo === "vencida"
          ? { inicio: sql`now() - interval '100 days'`, fin: sql`now() - interval '1 day'` }
          : { inicio: sql`now() - interval '1 day'`, fin: sql`now() + make_interval(days => ${modo.dias}::int)` };
    await base.update(membresias).set({ estado: "activa", ...fechas }).where(eq(membresias.id, d.membresiaId));
  }
  async function miembro(modo: "vigente" | "vencida" | { dias: number } = "vigente") {
    const d = nuevoDueno();
    await aprobarPago(d);
    await activarMembresia(d, modo);
    return d;
  }
  async function sembrar(d: Dueno, extra: Partial<Parameters<typeof filaReserva>[0]> & Record<string, unknown> = {}) {
    const { apoyo, ...resto } = extra as { apoyo?: Record<string, unknown> } & Partial<Parameters<typeof filaReserva>[0]>;
    const [r] = await base
      .insert(reservas)
      .values({ ...filaReserva({ ...d, equipoId: eq0(), horasAgenda: 4, ...resto, inicio: resto.inicio ?? a(nuevoDia()) }), ...apoyo })
      .returning();
    return r;
  }
  const leerReserva = async (id: string) => (await base.select().from(reservas).where(eq(reservas.id, id)))[0];
  const leerPago = async (id: string) => (await base.select().from(pagos).where(eq(pagos.id, id)))[0];
  const leerMembresia = async (id: string) => (await base.select().from(membresias).where(eq(membresias.id, id)))[0];
  const error = async (promesa: Promise<unknown>) => {
    try {
      await promesa;
    } catch (e) {
      return e as ErrorApi;
    }
    throw new Error("se esperaba un error");
  };

  // --- dependencias reales contra la rama --------------------------------------------------------------------
  const depPerfil = (extra: Partial<DependenciasPerfil> = {}): Partial<DependenciasPerfil> => ({
    base: (() => base) as never,
    leerConfig: async () => VALORES_DEL_DISENO,
    esperaReintentoMs: 0,
    ...extra,
  });
  const sinPasada = { pasada: async () => undefined };
  const depDetalle: DependenciasDetalle = { base: (() => base) as never, leerConfig: async () => VALORES_DEL_DISENO };
  const depCancelar: DependenciasCancelar = { base: (() => base) as never, leerConfig: async () => VALORES_DEL_DISENO, numeroWhatsapp: () => null };
  const depReprogramar = (equipoIds: number[]): DependenciasReprogramar => ({
    base: (() => base) as never,
    leerConfig: async () => VALORES_DEL_DISENO,
    numeroWhatsapp: () => null,
    equipoIds,
  });
  const depDisponibilidad: DependenciasDisponibilidadPropia = {
    leerReserva: async (usuarioId, reservaId) => {
      const [f] = await base.select({ h: reservas.horasAgenda }).from(reservas).where(and(eq(reservas.id, reservaId), eq(reservas.usuarioId, usuarioId)));
      return f ? { horasAgenda: Number(f.h) } : null;
    },
    leerConfig: async () => VALORES_DEL_DISENO,
    leerOcupacion: (v) => leerOcupacion(base, { ...v, equipoIds: esc.equipoIds }),
  };
  const cancelar = (d: Dueno, reservaId: string, ahora = AHORA) => cancelarReservaDelCliente({ usuario: usuarioDe(d.usuarioId), reservaId, ahora }, depCancelar);
  const reprogramar = (d: Dueno, reservaId: string, inicio: string, equipoIds = esc.equipoIds) =>
    reprogramarReserva({ usuario: usuarioDe(d.usuarioId), reservaId, cuerpo: { inicio }, ahora: AHORA }, depReprogramar(equipoIds));

  // ===========================================================================================================
  // 8.2 Aislamiento
  // ===========================================================================================================
  describe("aislamiento entre clientes", () => {
    it("A no ve ni toca nada de B por las cinco vías, y un administrador no dueño recibe 404", async () => {
      const A = await miembro();
      const B = await miembro();
      const rA = await sembrar(A, { equipoId: esc.equipoIds[1] });
      const rB = await sembrar(B, { equipoId: esc.equipoIds[1] });

      // GET /api/perfil de A: solo sus reservas.
      const perfil = await leerPerfil({ usuario: { id: A.usuarioId }, ahora: AHORA }, depPerfil(sinPasada));
      expect(perfil.proximas.map((p) => p.id)).toEqual([rA.id]);
      expect(JSON.stringify(perfil)).not.toContain(rB.id);

      // GET /api/reservas/:id de B con la sesión de A.
      expect((await error(leerDetalleReserva({ usuario: { id: A.usuarioId }, reservaId: rB.id, ahora: AHORA }, depDetalle))).status).toBe(404);
      // Cancelar y reprogramar la de B.
      expect((await error(cancelar(A, rB.id))).status).toBe(404);
      expect((await error(reprogramar(A, rB.id, a(nuevoDia())))).status).toBe(404);
      // Disponibilidad de la reserva de B.
      expect((await error(consultarDisponibilidadDeReserva({ usuarioId: A.usuarioId, reservaId: rB.id, fecha: nuevoDia(), ahora: AHORA }, depDisponibilidad))).status).toBe(404);
      // Un administrador que no es el dueño.
      expect((await error(leerDetalleReserva({ usuario: { id: admin.id }, reservaId: rA.id, ahora: AHORA }, depDetalle))).status).toBe(404);

      // La reserva de B no cambió.
      expect((await leerReserva(rB.id)).estado).toBe("confirmada");
      expect((await leerReserva(rB.id)).inicio).toEqual(rB.inicio);
    });

    it("la propia reserva se lee completa con su pago", async () => {
      const A = await miembro();
      const rA = await sembrar(A);
      const detalle = await leerDetalleReserva({ usuario: { id: A.usuarioId }, reservaId: rA.id, ahora: AHORA }, depDetalle);
      expect(detalle).toMatchObject({ id: rA.id, estado: "confirmada", pago: { id: A.pagoId, estado: "aprobado" }, puede_cancelar: true });
      expect(JSON.stringify(detalle)).not.toMatch(/equipo/i);
    });
  });

  // ===========================================================================================================
  // 8.3 Cancelar
  // ===========================================================================================================
  describe("cancelar", () => {
    it("una confirmada a 3 días queda cancelada por el cliente y otro cliente reserva su horario de inmediato", async () => {
      const A = await miembro();
      const C = await miembro();
      const dia = nuevoDia();
      const r = await sembrar(A, { inicio: a(dia) });
      const res = await cancelar(A, r.id);
      expect(res.reserva).toMatchObject({ estado: "cancelada", cancelada_por: "cliente" });
      const fila = await leerReserva(r.id);
      expect(fila).toMatchObject({ estado: "cancelada", canceladaPor: "cliente", expiraEn: null });
      // El mismo equipo y el mismo horario quedan libres de inmediato.
      const [otra] = await base.insert(reservas).values(filaReserva({ ...C, equipoId: eq0(), inicio: a(dia), horasAgenda: 4 })).returning({ id: reservas.id });
      expect(otra.id).toBeDefined();
    });

    it("exactamente 24 horas se permite; 23 h 59 min da 409 fuera_de_plazo y no cambia nada", async () => {
      const A = await miembro();
      const B = await miembro();
      const exacta = await sembrar(A, { equipoId: esc.equipoIds[0], inicio: "2099-01-06T10:00:00-05:00" });
      const justa = await sembrar(B, { equipoId: esc.equipoIds[1], inicio: "2099-01-06T09:59:00-05:00" });
      expect((await cancelar(A, exacta.id)).reserva.estado).toBe("cancelada");
      const e = await error(cancelar(B, justa.id));
      expect(e).toBeInstanceOf(ErrorFueraDePlazo);
      expect(e.status).toBe(409);
      expect((await leerReserva(justa.id)).estado).toBe("confirmada");
    });

    it("una pendiente cancelada deja el pago pendiente", async () => {
      const A = nuevoDueno(); // membresía y pago pendientes
      const r = await sembrar(A, { estado: "pendiente" });
      await cancelar(A, r.id);
      expect((await leerReserva(r.id)).estado).toBe("cancelada");
      expect((await leerPago(A.pagoId)).estado).toBe("pendiente");
      expect((await leerMembresia(A.membresiaId)).estado).toBe("pendiente");
    });

    // Ítem 14 invierte la prueba del ítem 12: cancelar con el pago aprobado ya genera el crédito en horas (ADR 0012), pero sigue
    // sin tocar el pago ni la membresía.
    it("con el pago aprobado, el pago y la membresía no cambian y se genera el crédito de lo pagado", async () => {
      const A = await miembro();
      const r = await sembrar(A);
      const pagoAntes = await leerPago(A.pagoId);
      const membresiaAntes = await leerMembresia(A.membresiaId);
      const c = await cancelar(A, r.id);
      expect(await leerPago(A.pagoId)).toEqual(pagoAntes);
      expect(await leerMembresia(A.membresiaId)).toEqual(membresiaAntes);
      const lotes = await base.select().from(creditosHoras).where(eq(creditosHoras.usuarioId, A.usuarioId));
      expect(lotes).toHaveLength(1);
      expect(lotes[0].reservaOrigenId).toBe(r.id);
      expect(Number(lotes[0].horasIniciales)).toBe(c.credito.generado_horas);
      expect(c.credito.generado_horas).toBeGreaterThan(0);
    });

    it("cancelar dos veces responde 200 la segunda", async () => {
      const A = await miembro();
      const r = await sembrar(A);
      await cancelar(A, r.id);
      expect((await cancelar(A, r.id)).reserva).toMatchObject({ estado: "cancelada", cancelada_por: "cliente" });
    });

    it("cancelar y aprobar a la vez: la reserva termina cancelada, el pago aprobado y el horario libre", async () => {
      const A = nuevoDueno();
      const dia = nuevoDia();
      const r = await sembrar(A, { estado: "pendiente", inicio: a(dia) });
      const aprobar = base.transaction(async (tx) => {
        await tx.select().from(pagos).where(eq(pagos.id, A.pagoId)).for("update");
        await tx.update(pagos).set({ estado: "aprobado", revisadoPor: admin.id, revisadoEn: sql`now()` }).where(eq(pagos.id, A.pagoId));
        // Como la aprobación real: solo confirma una reserva que sigue pendiente.
        await tx.update(reservas).set({ estado: "confirmada", expiraEn: null }).where(and(eq(reservas.pagoId, A.pagoId), eq(reservas.estado, "pendiente")));
      });
      const [, resultado] = await Promise.allSettled([aprobar, cancelar(A, r.id)]);
      expect(resultado.status).toBe("fulfilled");
      expect((await leerReserva(r.id)).estado).toBe("cancelada");
      expect((await leerPago(A.pagoId)).estado).toBe("aprobado");
      const C = await miembro();
      const [libre] = await base.insert(reservas).values(filaReserva({ ...C, equipoId: eq0(), inicio: a(dia), horasAgenda: 4 })).returning({ id: reservas.id });
      expect(libre.id).toBeDefined();
    });
  });

  // ===========================================================================================================
  // 8.4 Reprogramar
  // ===========================================================================================================
  describe("reprogramar", () => {
    it("mover una hora dentro del propio rango funciona (no choca consigo misma) y conserva precio, pago y primera_gratis", async () => {
      const A = await miembro();
      const dia = nuevoDia();
      const r = await sembrar(A, { inicio: a(dia), primeraGratis: true });
      const res = await reprogramar(A, r.id, a(dia, "11:00"));
      expect(res.reserva).toMatchObject({ id: r.id, estado: "confirmada", inicio: a(dia, "11:00") });
      const despues = await leerReserva(r.id);
      expect(despues).toMatchObject({ pagoId: r.pagoId, membresiaId: r.membresiaId, monto: r.monto, precioLista: r.precioLista, primeraGratis: true, estado: "confirmada" });
      expect(despues.inicio).toEqual(new Date(a(dia, "11:00")));
    });

    it("pasa a otro equipo cuando el actual está ocupado en el nuevo horario", async () => {
      const A = await miembro();
      const D = await miembro();
      const dia = nuevoDia();
      const r = await sembrar(A, { equipoId: esc.equipoIds[0], inicio: a(dia, "08:00"), horasAgenda: 2 });
      await sembrar(D, { equipoId: esc.equipoIds[0], inicio: a(dia, "13:00"), horasAgenda: 2 });
      await reprogramar(A, r.id, a(dia, "13:00"));
      expect((await leerReserva(r.id)).equipoId).not.toBe(esc.equipoIds[0]);
    });

    it("con todos los equipos ocupados da 409 y la reserva conserva su horario", async () => {
      const A = await miembro();
      const dia = nuevoDia();
      const r = await sembrar(A, { inicio: a(dia, "08:00"), horasAgenda: 2 });
      for (const equipo of esc.equipoIds) {
        const D = await miembro();
        await sembrar(D, { equipoId: equipo, inicio: a(dia, "13:00"), horasAgenda: 2 });
      }
      const e = await error(reprogramar(A, r.id, a(dia, "13:00")));
      expect(e.status).toBe(409);
      expect((await leerReserva(r.id)).inicio).toEqual(r.inicio);
    });

    it("dos clientes reprograman al último cupo a la vez: uno 200 y otro 409", async () => {
      const A = await miembro();
      const B = await miembro();
      const D = await miembro();
      const dia = nuevoDia();
      const [e0, e1] = esc.equipoIds;
      // Solo e0 y e1 son candidatos; e1 está ocupado en el horario objetivo, así que queda un único cupo (e0).
      await sembrar(D, { equipoId: e1, inicio: a(dia, "13:00"), horasAgenda: 2 });
      const rA = await sembrar(A, { equipoId: e0, inicio: a(dia, "08:00"), horasAgenda: 2 });
      const dia2 = nuevoDia();
      const rB = await sembrar(B, { equipoId: e0, inicio: a(dia2, "08:00"), horasAgenda: 2 });
      // B se mueve al mismo día/hora objetivo.
      const resultados = await Promise.allSettled([reprogramar(A, rA.id, a(dia, "13:00"), [e0, e1]), reprogramar(B, rB.id, a(dia, "13:00"), [e0, e1])]);
      const ok = resultados.filter((r) => r.status === "fulfilled");
      const rechazados = resultados.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(ok).toHaveLength(1);
      expect(rechazados).toHaveLength(1);
      expect((rechazados[0].reason as ErrorApi).status).toBe(409);
    });

    it("una pendiente vencida de otro cliente que bloqueaba el horario se marca expirada y la reprogramación se acepta", async () => {
      const A = await miembro();
      const E = nuevoDueno();
      const dia = nuevoDia();
      const e0 = esc.equipoIds[0];
      const r = await sembrar(A, { equipoId: e0, inicio: a(dia, "08:00"), horasAgenda: 2 });
      const vencida = await sembrar(E, { equipoId: e0, inicio: a(dia, "13:00"), horasAgenda: 2, estado: "pendiente", expiraEn: new Date(Date.now() - 3_600_000) });
      await reprogramar(A, r.id, a(dia, "13:00"), [e0]);
      expect((await leerReserva(vencida.id)).estado).toBe("expirada");
      expect((await leerReserva(r.id)).inicio).toEqual(new Date(a(dia, "13:00")));
    });

    it("la reserva pendiente conserva su expira_en y su pago", async () => {
      const A = nuevoDueno();
      const dia = nuevoDia();
      const expira = new Date(Date.now() + 20 * 3_600_000);
      const r = await sembrar(A, { estado: "pendiente", expiraEn: expira, inicio: a(dia) });
      const res = await reprogramar(A, r.id, a(dia, "11:00"));
      expect(res.reserva.estado).toBe("pendiente");
      const despues = await leerReserva(r.id);
      expect(despues.expiraEn).toEqual(expira);
      expect(despues.pagoId).toBe(A.pagoId);
    });

    it("apoyo coordinado vuelve a por_coordinar y la nota se conserva", async () => {
      const A = await miembro();
      const dia = nuevoDia();
      const r = await sembrar(A, { inicio: a(dia), apoyo: { requiereApoyo: true, apoyoEstado: "coordinado", apoyoNota: "Rosa, 987654321" } });
      await reprogramar(A, r.id, a(dia, "11:00"));
      expect(await leerReserva(r.id)).toMatchObject({ apoyoEstado: "por_coordinar", apoyoNota: "Rosa, 987654321", requiereApoyo: true });
    });

    it("la disponibilidad excluye la propia reserva (y sin excluirla el hueco figuraría ocupado)", async () => {
      const A = await miembro();
      const dia = nuevoDia();
      const [e0, e1, e2] = esc.equipoIds;
      const r = await sembrar(A, { equipoId: e0, inicio: a(dia, "10:00"), horasAgenda: 3 });
      for (const equipo of [e1, e2]) {
        const D = await miembro();
        await sembrar(D, { equipoId: equipo, inicio: a(dia, "08:00"), horasAgenda: 8 });
      }
      const res = await consultarDisponibilidadDeReserva({ usuarioId: A.usuarioId, reservaId: r.id, fecha: dia, ahora: AHORA }, depDisponibilidad);
      const h11 = res.horarios.find((h) => h.hora === "11:00");
      expect(h11).toMatchObject({ disponible: true });

      // Sin excluir la reserva, el mismo horario figura sin cupo: eso prueba que `excluirReservaId` es lo que lo libera.
      const sinExcluir = await leerOcupacion(base, { desde: new Date(a(dia, "00:00")), hasta: new Date(a(dia, "23:59")), equipoIds: esc.equipoIds });
      expect(sinExcluir.ocupadas.some((o) => o.equipoId === e0)).toBe(true);
      expect(JSON.stringify(res)).not.toMatch(/equipo|usuario/i);
    });
  });

  // ===========================================================================================================
  // 8.5 La primera limpieza gratis cancelada no se pierde
  // ===========================================================================================================
  describe("primera limpieza cancelada", () => {
    let contadorHogar = 0;
    const cuerpo = (dia: string, numero: string) => ({
      servicio: { tipo: "profunda", dormitorios: 2, banos: 1 },
      inicio: a(dia),
      direccion: { distrito: "Miraflores", calle: "Av. Larco", numero },
      metodo: "yape",
      comprobante: "comprobante-de-prueba",
    });
    const depCrear = (usuario: Usuario): DependenciasCrear => ({
      leerConfig: async () => VALORES_DEL_DISENO,
      verificarImagen: async () => ({ ruta: `comprobantes/${usuario.id}/bd.jpg`, tipo: "image/jpeg", tamano: 1000 }),
      base: (() => base) as never,
      equipoIds: esc.equipoIds.slice(0, 2),
      numeroWhatsapp: () => null,
    });
    const hogarDe = (numero: string) => ({ distrito: "Miraflores" as const, direccionNormalizada: `avenida larco ${numero}`, departamentoNormalizado: "" });

    // Crea la primera reserva con la función real y fija en la base lo que haría el administrador: pago aprobado y membresía activa.
    async function primeraAprobada(usuario: Usuario, numero: string) {
      const { reserva, pago, membresia } = await crearPrimeraReserva({ usuario, cuerpo: cuerpo(nuevoDia(), numero), ahora: AHORA }, depCrear(usuario));
      await base.update(pagos).set({ estado: "aprobado", revisadoPor: admin.id, revisadoEn: sql`now()` }).where(eq(pagos.id, pago.id));
      await base.update(reservas).set({ estado: "confirmada", expiraEn: null }).where(eq(reservas.id, reserva.id));
      await base.update(membresias).set({ estado: "activa", inicio: new Date("2098-12-01T15:00:00Z"), fin: FIN_MEMBRESIA }).where(eq(membresias.id, membresia.id));
      return { reservaId: reserva.id, pagoId: pago.id };
    }
    const cancelarComo = (usuario: Usuario, reservaId: string) => cancelarReservaDelCliente({ usuario, reservaId, ahora: AHORA }, depCancelar);

    it("al cancelar con la función real, decidirLimpiezaGratis para su hogar devuelve verdadero", async () => {
      const [u] = await esc.crearClientes(1);
      const numero = String(2000 + ++contadorHogar);
      const { reservaId } = await primeraAprobada(u, numero);
      const res = await cancelarComo(u, reservaId);
      expect(res.limpieza_gratis_conservada).toBe(true);
      expect(await decidirLimpiezaGratis(base, u.id, hogarDe(numero))).toBe(true);
      // Los índices del ítem 10 aceptan la nueva reserva gratis después de la cancelada.
      const [pagoNuevo] = await base
        .insert(pagos)
        .values({ usuarioId: u.id, concepto: "reserva", monto: 0, metodo: "yape", comprobanteRuta: `comprobantes/${u.id}/otra.jpg` })
        .returning({ id: pagos.id });
      const [m] = await base.select({ id: membresias.id }).from(membresias).where(eq(membresias.usuarioId, u.id));
      const [nueva] = await base
        .insert(reservas)
        .values(
          filaReserva({
            usuarioId: u.id,
            membresiaId: m.id,
            pagoId: pagoNuevo.id,
            equipoId: eq0(),
            inicio: a(nuevoDia()),
            horasAgenda: 3,
            primeraGratis: true,
            direccionNormalizada: `avenida larco ${numero}`,
          }),
        )
        .returning({ id: reservas.id });
      expect(nueva.id).toBeDefined();
    });

    it("con una reserva completada, no se conserva", async () => {
      const [u] = await esc.crearClientes(1);
      const numero = String(2000 + ++contadorHogar);
      const { reservaId } = await primeraAprobada(u, numero);
      const [m] = await base.select({ id: membresias.id }).from(membresias).where(eq(membresias.usuarioId, u.id));
      const [pagoExtra] = await base
        .insert(pagos)
        .values({ usuarioId: u.id, concepto: "reserva", monto: 12900, metodo: "yape", comprobanteRuta: `comprobantes/${u.id}/extra.jpg`, estado: "aprobado" })
        .returning({ id: pagos.id });
      await base.insert(reservas).values(filaReserva({ usuarioId: u.id, membresiaId: m.id, pagoId: pagoExtra.id, equipoId: esc.equipoIds[2], inicio: a(nuevoDia()), horasAgenda: 3, estado: "completada" }));
      const res = await cancelarComo(u, reservaId);
      expect(res.limpieza_gratis_conservada).toBe(false);
      expect(await decidirLimpiezaGratis(base, u.id, hogarDe(numero))).toBe(false);
    });

    it("si otra cuenta recibe la limpieza gratis del hogar después, devuelve falso", async () => {
      const [u, otra] = await esc.crearClientes(2);
      const numero = String(2000 + ++contadorHogar);
      const { reservaId } = await primeraAprobada(u, numero);
      await cancelarComo(u, reservaId);
      await crearPrimeraReserva({ usuario: otra, cuerpo: cuerpo(nuevoDia(), numero), ahora: AHORA }, depCrear(otra));
      expect(await decidirLimpiezaGratis(base, u.id, hogarDe(numero))).toBe(false);
    });
  });

  // ===========================================================================================================
  // 8.6 Membresía y avisos
  // ===========================================================================================================
  describe("membresía y avisos", () => {
    const perfilDe = (d: Dueno, extra: Partial<DependenciasPerfil> = sinPasada) => leerPerfil({ usuario: { id: d.usuarioId }, ahora: AHORA }, depPerfil(extra));

    it("en_revision", async () => {
      const A = nuevoDueno();
      const p = await perfilDe(A);
      expect(p.membresia).toMatchObject({ estado: "en_revision", pago_id: A.pagoId });
      expect(p.avisos.map((x) => x.codigo)).toContain("en_revision");
    });

    it("pago_rechazado con reenvio_hasta dentro del plazo", async () => {
      const A = nuevoDueno();
      await esc.rechazarHace(A.pagoId, admin.id, 24, "Imagen borrosa");
      // El plazo viene del reloj de la base; los días que se muestran se miden con el `ahora` real, no con el de 2099.
      const p = await leerPerfil({ usuario: { id: A.usuarioId }, ahora: new Date() }, depPerfil(sinPasada));
      expect(p.membresia).toMatchObject({ estado: "pago_rechazado", pago_id: A.pagoId, motivo_rechazo: "Imagen borrosa" });
      const aviso = p.avisos.find((x) => x.codigo === "pago_rechazado");
      expect(aviso).toMatchObject({ dias_restantes: 6, motivo: "Imagen borrosa" });
      expect(aviso?.reenvio_hasta).toMatch(/-05:00$/);
    });

    it("plazo vencido sin que el cierre haya corrido: no ofrece reenviar, ofrece empezar de nuevo", async () => {
      const A = nuevoDueno();
      await esc.rechazarHace(A.pagoId, admin.id, 24 * 8);
      const p = await perfilDe(A); // sin pasada: la membresía sigue `pendiente`
      expect((await leerMembresia(A.membresiaId)).estado).toBe("pendiente");
      expect(p.membresia).toEqual({ estado: "sin_membresia", plazo_vencido: true });
      expect(p.avisos.map((x) => x.codigo)).toEqual(["plazo_vencido"]);
    });

    it("activa con dias_restantes calculados con el reloj de la base", async () => {
      const A = await miembro({ dias: 40 });
      const p = await perfilDe(A);
      expect(p.membresia).toMatchObject({ estado: "activa", dias_restantes: 40 });
    });

    it("vencida se calcula con `fin` pasado sin cambiar la fila", async () => {
      const A = await miembro("vencida");
      const p = await perfilDe(A);
      expect(p.membresia.estado).toBe("vencida");
      expect((await leerMembresia(A.membresiaId)).estado).toBe("activa");
    });

    it("una membresía caducada es sin_membresia", async () => {
      const A = nuevoDueno();
      await esc.rechazarHace(A.pagoId, admin.id, 24 * 8);
      await base.update(membresias).set({ estado: "caducada" }).where(eq(membresias.id, A.membresiaId));
      expect((await perfilDe(A)).membresia).toEqual({ estado: "sin_membresia", plazo_vencido: true });
    });

    it("aprobación tardía: reserva expirada con pago aprobado muestra 'Elige un nuevo día y hora'", async () => {
      const A = await miembro();
      await sembrar(A, { estado: "expirada" });
      const p = await perfilDe(A);
      const aviso = p.avisos.find((x) => x.codigo === "nuevo_horario");
      expect(aviso?.texto).toContain("Elige un nuevo día y hora");
      expect(aviso?.pago_id).toBe(A.pagoId);
    });

    it("cancelada por el cliente con el pago aprobado no muestra el aviso; cancelada por el administrador sí", async () => {
      const cliente = await miembro();
      const rC = await sembrar(cliente);
      await cancelar(cliente, rC.id);
      expect((await perfilDe(cliente)).avisos.map((x) => x.codigo)).not.toContain("nuevo_horario");

      const porAdmin = await miembro();
      const rA = await sembrar(porAdmin);
      await base.update(reservas).set({ estado: "cancelada", canceladaPor: "admin" }).where(eq(reservas.id, rA.id));
      expect((await perfilDe(porAdmin)).avisos.map((x) => x.codigo)).toContain("nuevo_horario");
    });

    it("una pendiente vencida aparece expirada en el historial y queda expirada en la base tras abrir el perfil", async () => {
      const A = nuevoDueno();
      const r = await sembrar(A, { estado: "pendiente", expiraEn: new Date(Date.now() - 3_600_000) });
      // Con la pasada real del ítem 11.
      const p = await perfilDe(A, {});
      expect(p.proximas).toEqual([]);
      expect(p.historial.find((h) => h.id === r.id)?.estado).toBe("expirada");
      expect((await leerReserva(r.id)).estado).toBe("expirada");
    });

    it("la limpieza gratis cancelada se avisa al miembro activo", async () => {
      const A = await miembro();
      const r = await sembrar(A, { primeraGratis: true, estado: "cancelada", direccionNormalizada: "prueba perfil hogar 9001" });
      expect(r.id).toBeDefined();
      const p = await perfilDe(A);
      expect(p.avisos.map((x) => x.codigo)).toContain("limpieza_gratis_conservada");
    });
  });

});
