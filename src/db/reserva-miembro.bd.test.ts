import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "@/lib/__fixtures__/configuracion";
import { instanteLocal } from "@/lib/agenda/horario";
import { leerOcupacion } from "@/lib/agenda/leer";
import { ErrorApi } from "@/lib/errores";
import { verificarImagenSubida } from "@/lib/imagenes/verificar";
import { aprobarPago, type DependenciasRevision } from "@/lib/pagos/revision";
import { crearPrimeraReserva, crearReserva, type DependenciasCrear, type DependenciasReserva } from "@/lib/reservas/crear";
import { tieneMembresiaActiva } from "@/lib/reservas/membresia-vigente";
import { crearReservaDeMiembro, type DependenciasMiembro } from "@/lib/reservas/miembro";
import { crearReservaDeNuevoHorario, type DependenciasNuevoHorario } from "@/lib/reservas/nuevo-horario";
import { leerDisponibilidadNuevoHorario, leerNuevoHorario, type DependenciasNuevoHorarioDatos } from "@/lib/reservas/nuevo-horario-datos";
import type { Usuario } from "@/lib/sesion";
import { membresias, pagos, reservas } from "./esquema";
import { PRUEBAS_BD_ACTIVAS, contarRastros, crearBasePruebas, crearEscenario, filaReserva, type BasePruebas } from "./pruebas-bd";

// Reserva de un miembro activo y nuevo horario con un pago ya aprobado, contra la rama `pruebas` de Neon (change
// reservar-como-miembro-activo). Corre con PRUEBAS_BD=1. Equipos de prueba INACTIVOS, fechas de 2099 y membresías con `fin`
// fijo; el reloj de los plazos (`expira_en`, `fin > now()`) es el de la base.
const AHORA = instanteLocal("2099-01-05", "10:00", "America/Lima"); // lunes
const HORA = 3_600_000;

// Un día distinto para cada reserva (lunes a sábado desde el 12 de enero de 2099, antes del fin de las membresías de prueba).
const DIAS: string[] = [];
for (let t = Date.UTC(2099, 0, 12); DIAS.length < 90; t += 86_400_000) {
  if (new Date(t).getUTCDay() !== 0) DIAS.push(new Date(t).toISOString().slice(0, 10));
}
let siguienteDia = 0;
const nuevoDia = () => DIAS[siguienteDia++];

describe.skipIf(!PRUEBAS_BD_ACTIVAS)("reserva de un miembro y nuevo horario (Neon)", () => {
  let ctx: ReturnType<typeof crearBasePruebas>;
  let base: BasePruebas;
  let esc: Awaited<ReturnType<typeof crearEscenario>>;
  let admin: { id: string };
  let numeroDeCasa = 500;

  beforeAll(async () => {
    ctx = crearBasePruebas();
    base = ctx.base;
    esc = await crearEscenario(base);
    admin = await esc.crearAdmin();
  });

  afterAll(async () => {
    await esc?.limpiar();
    if (base) expect(await contarRastros(base)).toBe(0);
    await ctx?.cerrar();
  });

  // --- Dependencias contra la rama (nunca la base de producción) ---
  const dosEquipos = () => esc.equipoIds.slice(0, 2);
  const rutaVerificada = (usuario: Usuario) => `comprobantes/${usuario.id}/bd.jpg`;
  const depsMiembro = (usuario: Usuario, extra: Partial<DependenciasMiembro> = {}): DependenciasMiembro => ({
    leerConfig: async () => VALORES_DEL_DISENO,
    verificarImagen: async () => ({ ruta: rutaVerificada(usuario), tipo: "image/jpeg", tamano: 1000 }),
    base: () => base,
    equipoIds: dosEquipos(),
    numeroWhatsapp: () => null,
    ...extra,
  });
  const depsCrear = (usuario: Usuario): DependenciasCrear => depsMiembro(usuario);
  const depsRevision: DependenciasRevision = { base: () => base, leerConfig: async () => VALORES_DEL_DISENO };
  const depsNuevoHorario: DependenciasNuevoHorario = {
    base: () => base,
    leerConfig: async () => VALORES_DEL_DISENO,
    numeroWhatsapp: () => null,
    equipoIds: undefined,
  };
  const depsDatos: DependenciasNuevoHorarioDatos = {
    base: () => base,
    leerConfig: async () => VALORES_DEL_DISENO,
    leerOcupacion: (ventana) => leerOcupacion(base, { ...ventana, equipoIds: dosEquipos() }),
  };

  const reservarMiembro = (usuario: Usuario, c: unknown, extra: Partial<DependenciasMiembro> = {}) =>
    crearReservaDeMiembro({ usuario, cuerpo: c, ahora: AHORA }, depsMiembro(usuario, extra));
  const nuevoHorario = (usuario: Usuario, pagoId: string, inicio: string, equipoIds = dosEquipos()) =>
    crearReservaDeNuevoHorario({ usuario, pagoId, cuerpo: { inicio }, ahora: AHORA }, { ...depsNuevoHorario, equipoIds });
  const aprobar = (pagoId: string) => aprobarPago({ admin, pagoId }, depsRevision);

  const error = async (promesa: Promise<unknown>) => {
    try {
      await promesa;
    } catch (e) {
      return e as ErrorApi;
    }
    throw new Error("se esperaba un error");
  };

  const direccionNueva = () => ({ distrito: "Miraflores", calle: "Av. Miembros Prueba", numero: String(numeroDeCasa++) });
  const cuerpo = (dia: string, direccion: Record<string, unknown> = direccionNueva(), extra: Record<string, unknown> = {}, hora = "10:00") => ({
    servicio: { tipo: "estandar", dormitorios: 2, banos: 1 },
    inicio: `${dia}T${hora}:00-05:00`,
    direccion,
    metodo: "yape",
    comprobante: "comprobante-de-prueba",
    ...extra,
  });

  const pagoDe = async (id: string) => (await base.select().from(pagos).where(eq(pagos.id, id)))[0];
  const reservaDe = async (id: string) => (await base.select().from(reservas).where(eq(reservas.id, id)))[0];
  const membresiaDe = async (id: string) => (await base.select().from(membresias).where(eq(membresias.id, id)))[0];
  const filasDe = async (usuarioId: string) => ({
    pagos: await base.select().from(pagos).where(eq(pagos.usuarioId, usuarioId)),
    reservas: await base.select().from(reservas).where(eq(reservas.usuarioId, usuarioId)),
  });
  const totalDe = async (usuarioId: string) => {
    const f = await filasDe(usuarioId);
    return f.pagos.length + f.reservas.length;
  };
  const vivasDe = async (usuarioId: string) =>
    (await base.select().from(reservas).where(eq(reservas.usuarioId, usuarioId))).filter((r) => ["pendiente", "confirmada", "completada"].includes(r.estado));

  // Ocupa un equipo en un rango con una reserva de otro cliente (con su membresía y pago de prueba).
  async function ocupar(equipoId: number, dia: string, hora: string, horas: number, estado: "confirmada" | "pendiente" = "confirmada", expiraEn?: Date) {
    const [d] = await esc.crearDuenos(1);
    const [fila] = await base
      .insert(reservas)
      .values(filaReserva({ ...d, equipoId, inicio: `${dia}T${hora}:00-05:00`, horasAgenda: horas, estado, expiraEn }))
      .returning({ id: reservas.id });
    return fila.id;
  }

  // Un cliente nuevo que hace su primera reserva por el flujo real y a quien se le "aprueba" el pago directo en la base:
  // membresía activa con fin fijo, pago aprobado y la reserva en el estado pedido (cancelada por el cliente, completada…).
  async function clienteConPrimera(estadoFinal: "cancelada" | "completada" | "confirmada", direccion = direccionNueva(), dia = nuevoDia()) {
    const [cliente] = await esc.crearClientes(1);
    const r = await crearPrimeraReserva(
      { usuario: cliente, cuerpo: { ...cuerpo(dia, direccion), servicio: { tipo: "profunda", dormitorios: 2, banos: 1 } }, ahora: AHORA },
      depsCrear(cliente),
    );
    await base
      .update(membresias)
      .set({ estado: "activa", inicio: new Date("2098-12-01T15:00:00Z"), fin: new Date("2099-04-30T15:00:00Z") })
      .where(eq(membresias.id, r.membresia.id));
    await base.update(pagos).set({ estado: "aprobado", revisadoPor: admin.id, revisadoEn: sql`now()` }).where(eq(pagos.id, r.pago.id));
    await base
      .update(reservas)
      .set(estadoFinal === "cancelada" ? { estado: "cancelada", canceladaPor: "cliente", expiraEn: null } : { estado: estadoFinal, expiraEn: null })
      .where(eq(reservas.id, r.reserva.id));
    return { cliente, direccion, pagoId: r.pago.id, reservaId: r.reserva.id, membresiaId: r.membresia.id };
  }

  const venceReserva = (reservaId: string) =>
    base.update(reservas).set({ expiraEn: sql`now() - interval '1 hour'` }).where(eq(reservas.id, reservaId));

  // Un miembro que ya tuvo su limpieza (completada) y por eso paga la limpieza completa con descuento. Un miembro sin ninguna
  // reserva recibiría las 3 horas gratis.
  async function miembroSinGratis() {
    const c = await clienteConPrimera("completada");
    return { usuario: c.cliente, membresiaId: c.membresiaId };
  }

  // Un miembro con una reserva de pago pendiente que se aprueba TARDE (después de vencer): deja el pago aprobado y la reserva
  // expirada, listo para elegir un nuevo horario.
  async function conAprobacionTardia(servicio: unknown = { tipo: "estandar", dormitorios: 2, banos: 1 }) {
    const c = await clienteConPrimera("completada");
    const m = { usuario: c.cliente, membresiaId: c.membresiaId };
    const r = await reservarMiembro(m.usuario, { ...cuerpo(nuevoDia()), servicio });
    await venceReserva(r.reserva.id);
    const aprobacion = await aprobar(r.pago.id);
    return { ...m, pagoId: r.pago.id, reservaId: r.reserva.id, aprobacion };
  }

  describe("reserva de un miembro", () => {
    it("guarda el precio con descuento, el pago de reserva sin membresía y la reserva pendiente con expira_en de la base", async () => {
      const m = await miembroSinGratis();
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      expect(r.membresia).toBeNull();
      expect(r.reserva).toMatchObject({ estado: "pendiente", monto: 11610, precio_lista: 12900 });

      const f = await filasDe(m.usuario.id);
      const p = f.pagos.find((x) => x.id === r.pago.id)!;
      const res = f.reservas.find((x) => x.id === r.reserva.id)!;
      expect(p).toMatchObject({ concepto: "reserva", membresiaId: null, monto: 11610, metodo: "yape", estado: "pendiente", comprobanteRuta: rutaVerificada(m.usuario) });
      expect(res).toMatchObject({ estado: "pendiente", membresiaId: m.membresiaId, pagoId: p.id, monto: 11610, descuento: 1290, precioLista: 12900, primeraGratis: false });
      expect(res.expiraEn!.getTime() - res.creadaEn.getTime()).toBe(24 * HORA);
      expect(dosEquipos()).toContain(res.equipoId);
    });

    it("aprobar el pago con la función del #11 deja la reserva confirmada sin tocar la membresía", async () => {
      const [m] = await esc.crearMiembros(1);
      const r = await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      const antes = await membresiaDe(m.membresiaId);
      const a = await aprobar(r.pago.id);
      expect(a.membresia).toBeNull();
      expect(a.nuevo_horario_pendiente).toBe(false);
      expect(await reservaDe(r.reserva.id)).toMatchObject({ estado: "confirmada", expiraEn: null });
      expect(await pagoDe(r.pago.id)).toMatchObject({ estado: "aprobado", revisadoPor: admin.id });
      expect(await membresiaDe(m.membresiaId)).toEqual(antes);
    });

    it("sin cupo no deja ni pago ni reserva", async () => {
      const [m] = await esc.crearMiembros(1);
      const dia = nuevoDia();
      await ocupar(esc.equipoIds[0], dia, "10:00", 5);
      await ocupar(esc.equipoIds[1], dia, "10:00", 5);
      const e = await error(reservarMiembro(m.usuario, cuerpo(dia)));
      expect(e).toMatchObject({ status: 409, codigo: "conflicto" });
      expect(await totalDe(m.usuario.id)).toBe(0);
    });

    it("dos miembros por el último cupo: uno recibe 201 y el otro 409", async () => {
      const [a, b] = await esc.crearMiembros(2);
      const dia = nuevoDia();
      await ocupar(esc.equipoIds[0], dia, "10:00", 5);
      const resultados = await Promise.allSettled([reservarMiembro(a.usuario, cuerpo(dia)), reservarMiembro(b.usuario, cuerpo(dia))]);
      const ok = resultados.filter((r) => r.status === "fulfilled");
      const fallos = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(ok).toHaveLength(1);
      expect(fallos).toHaveLength(1);
      expect(fallos[0].reason).toMatchObject({ status: 409, codigo: "conflicto" });
      expect((await vivasDe(a.usuario.id)).length + (await vivasDe(b.usuario.id)).length).toBe(1);
    });

    it("una pendiente vencida de otro cliente se marca expirada y la reserva se acepta", async () => {
      const [m] = await esc.crearMiembros(1);
      const dia = nuevoDia();
      await ocupar(esc.equipoIds[0], dia, "10:00", 5);
      const vencida = await ocupar(esc.equipoIds[1], dia, "10:00", 5, "pendiente", new Date(Date.now() - HORA));
      const r = await reservarMiembro(m.usuario, cuerpo(dia));
      expect(r.reserva.estado).toBe("pendiente");
      expect((await reservaDe(vencida)).estado).toBe("expirada");
    });

    it("una segunda reserva en espera responde 409 en_espera y no crea nada", async () => {
      const [m] = await esc.crearMiembros(1);
      await reservarMiembro(m.usuario, cuerpo(nuevoDia()));
      const e = await error(reservarMiembro(m.usuario, cuerpo(nuevoDia())));
      expect(e).toMatchObject({ status: 409, codigo: "en_espera", message: "Ya tienes una reserva esperando la aprobación de tu pago." });
      expect(await totalDe(m.usuario.id)).toBe(2); // un pago y una reserva de la primera
    });

    it("dos peticiones simultáneas del mismo miembro: una 201 y la otra 409 en_espera", async () => {
      const [m] = await esc.crearMiembros(1);
      const resultados = await Promise.allSettled([reservarMiembro(m.usuario, cuerpo(nuevoDia())), reservarMiembro(m.usuario, cuerpo(nuevoDia()))]);
      const fallos = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(fallos[0].reason).toMatchObject({ status: 409, codigo: "en_espera" });
      expect((await filasDe(m.usuario.id)).reservas).toHaveLength(1);
    });

    it("un comprobante ajeno se rechaza antes de la transacción y no crea nada", async () => {
      const [m] = await esc.crearMiembros(1);
      const almacen = { metadatos: async () => ({ tamano: 1000, tipoDeclarado: "image/png" }), leerInicio: async () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) };
      const e = await error(
        reservarMiembro(m.usuario, cuerpo(nuevoDia(), undefined, { comprobante: "comprobantes/otro-usuario/x.png" }), {
          verificarImagen: (entrada) => verificarImagenSubida(entrada as Parameters<typeof verificarImagenSubida>[0], almacen),
        }),
      );
      expect(e).toMatchObject({ status: 422 });
      expect(await totalDe(m.usuario.id)).toBe(0);
    });

    it("el despachador manda al miembro por su rama y a quien no es miembro por la de la primera", async () => {
      const [m] = await esc.crearMiembros(1);
      const [nuevo] = await esc.crearClientes(1);
      const deps = (u: Usuario): DependenciasReserva => ({ ...depsMiembro(u), esMiembro: (id) => tieneMembresiaActiva(base, id) });
      const rm = await crearReserva({ usuario: m.usuario, cuerpo: cuerpo(nuevoDia()), ahora: AHORA }, deps(m.usuario));
      expect(rm.membresia).toBeNull();
      const rn = await crearReserva({ usuario: nuevo, cuerpo: cuerpo(nuevoDia()), ahora: AHORA }, deps(nuevo));
      expect(rn.membresia).toMatchObject({ estado: "pendiente" });
    });
  });

  describe("vigencia de la membresía", () => {
    // Un miembro cuya membresía termina en `fin`; se reserva el `dia` a las 10:00.
    const conFin = async (fin: string) => (await esc.crearMiembros(1, { inicio: "2020-01-01T10:00:00-05:00", fin }))[0];

    it("un inicio 30 minutos antes del fin se acepta", async () => {
      const dia = nuevoDia();
      const m = await conFin(`${dia}T10:30:00-05:00`);
      await expect(reservarMiembro(m.usuario, cuerpo(dia))).resolves.toMatchObject({ reserva: { estado: "pendiente" } });
    });

    it("un inicio igual al fin o posterior da 422 y no crea filas", async () => {
      const dia = nuevoDia();
      const igual = await conFin(`${dia}T10:00:00-05:00`);
      expect(await error(reservarMiembro(igual.usuario, cuerpo(dia)))).toMatchObject({ status: 422, message: expect.stringMatching(/renueva tu membresía/) });
      expect(await totalDe(igual.usuario.id)).toBe(0);

      const dia2 = nuevoDia();
      const antes = await conFin(`${dia2}T08:00:00-05:00`);
      expect(await error(reservarMiembro(antes.usuario, cuerpo(dia2)))).toMatchObject({ status: 422 });
      expect(await totalDe(antes.usuario.id)).toBe(0);
    });

    it("una membresía con el fin pasado da 422 para cualquier fecha", async () => {
      const m = await conFin("2025-06-01T10:00:00-05:00");
      expect(await error(reservarMiembro(m.usuario, cuerpo(nuevoDia())))).toMatchObject({ status: 422 });
      expect(await totalDe(m.usuario.id)).toBe(0);
    });

    it("con dos membresías activas se usa la de fin más lejano y la reserva apunta a esa", async () => {
      const dia = nuevoDia();
      const [corta] = await esc.crearMiembros(1, { inicio: "2098-01-01T10:00:00-05:00", fin: "2099-01-08T10:00:00-05:00" });
      const [larga] = await base
        .insert(membresias)
        .values({ usuarioId: corta.usuario.id, monto: 26700, estado: "activa", inicio: new Date("2098-12-01T15:00:00Z"), fin: new Date(`${dia}T20:00:00Z`) })
        .returning({ id: membresias.id });
      const r = await reservarMiembro(corta.usuario, cuerpo(dia));
      expect((await reservaDe(r.reserva.id)).membresiaId).toBe(larga.id);
    });
  });

  describe("limpieza gratis conservada", () => {
    const profunda = { tipo: "profunda", dormitorios: 2, banos: 1 };
    const estandar3h = { tipo: "estandar", dormitorios: 1, banos: 1 };

    it("tras cancelar la primera, la siguiente de 5 h recibe 3 horas gratis: monto 6966 con comprobante", async () => {
      const c = await clienteConPrimera("cancelada");
      const r = await reservarMiembro(c.cliente, cuerpo(nuevoDia(), c.direccion, { servicio: profunda }));
      expect(r.reserva).toMatchObject({ estado: "pendiente", monto: 6966, horas_gratis_aplicadas: 3 });
      const res = await reservaDe(r.reserva.id);
      expect(res).toMatchObject({ primeraGratis: true, monto: 6966, membresiaId: c.membresiaId });
      expect(await pagoDe(r.pago.id)).toMatchObject({ concepto: "reserva", monto: 6966, estado: "pendiente", metodo: "yape", membresiaId: null });
    });

    it("tras cancelar la primera, una estándar de 3 h nace confirmada con un pago interno de monto 0", async () => {
      const c = await clienteConPrimera("cancelada");
      const r = await reservarMiembro(c.cliente, cuerpo(nuevoDia(), c.direccion, { servicio: estandar3h }));
      expect(r.reserva).toMatchObject({ estado: "confirmada", expira_en: null, monto: 0 });
      expect(await reservaDe(r.reserva.id)).toMatchObject({ estado: "confirmada", expiraEn: null, primeraGratis: true, monto: 0 });
      expect(await pagoDe(r.pago.id)).toMatchObject({ concepto: "reserva", membresiaId: null, monto: 0, metodo: "credito", estado: "aprobado", comprobanteRuta: null });
    });

    it("con una limpieza completada no hay horas gratis", async () => {
      const c = await clienteConPrimera("completada");
      const r = await reservarMiembro(c.cliente, cuerpo(nuevoDia(), c.direccion, { servicio: profunda }));
      expect(r.reserva).toMatchObject({ monto: 17415, horas_gratis_aplicadas: 0 });
      expect((await reservaDe(r.reserva.id)).primeraGratis).toBe(false);
    });

    it("con el hogar tomado por otra cuenta no hay horas gratis", async () => {
      const dueno = await clienteConPrimera("confirmada");
      const [otro] = await esc.crearMiembros(1);
      const r = await reservarMiembro(otro.usuario, cuerpo(nuevoDia(), dueno.direccion, { servicio: profunda }));
      expect(r.reserva).toMatchObject({ monto: 17415, horas_gratis_aplicadas: 0 });
      expect((await reservaDe(r.reserva.id)).primeraGratis).toBe(false);
    });

    it("con otra dirección sin tomar, la regla se decide por la dirección nueva", async () => {
      const c = await clienteConPrimera("cancelada");
      const otra = direccionNueva();
      const r = await reservarMiembro(c.cliente, cuerpo(nuevoDia(), otra, { servicio: profunda }));
      expect(r.reserva).toMatchObject({ monto: 6966, horas_gratis_aplicadas: 3 });
    });

    it("con una reserva pendiente previa el monto 0 también da 409 en_espera y no deja filas nuevas", async () => {
      const c = await clienteConPrimera("cancelada");
      await reservarMiembro(c.cliente, cuerpo(nuevoDia(), c.direccion, { servicio: profunda })); // queda pendiente
      const antes = await totalDe(c.cliente.id);
      const e = await error(reservarMiembro(c.cliente, cuerpo(nuevoDia(), direccionNueva(), { servicio: estandar3h })));
      expect(e).toMatchObject({ status: 409, codigo: "en_espera" });
      expect(await totalDe(c.cliente.id)).toBe(antes);
    });

    it("dos peticiones simultáneas por la gratis de un mismo hogar: nunca hay dos reservas gratis vivas", async () => {
      const [a, b] = await esc.crearMiembros(2);
      const direccion = direccionNueva();
      const resultados = await Promise.allSettled([
        reservarMiembro(a.usuario, cuerpo(nuevoDia(), direccion, { servicio: profunda })),
        reservarMiembro(b.usuario, cuerpo(nuevoDia(), direccion, { servicio: profunda })),
      ]);
      const ok = resultados.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof reservarMiembro>>> => r.status === "fulfilled");
      const fallos = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      // Solo una recibe la gratis; la otra paga el precio completo o recibe 409 limpieza_gratis_usada, según el orden.
      expect(ok.length).toBeGreaterThanOrEqual(1);
      for (const f of fallos) expect(f.reason).toMatchObject({ status: 409, codigo: "limpieza_gratis_usada" });
      const gratis = [...(await vivasDe(a.usuario.id)), ...(await vivasDe(b.usuario.id))].filter((r) => r.primeraGratis);
      expect(gratis.length).toBe(1);
    });
  });

  describe("nuevo horario con el pago aprobado", () => {
    it("crea una reserva confirmada con el mismo pago, sin pago nuevo; copia servicio, dirección y monto; la original sigue expirada", async () => {
      const t = await conAprobacionTardia();
      expect(t.aprobacion.nuevo_horario_pendiente).toBe(true);
      const dia = nuevoDia();
      const pagosAntes = (await filasDe(t.usuario.id)).pagos.length;
      const r = await nuevoHorario(t.usuario, t.pagoId, `${dia}T11:00:00-05:00`);
      expect(r.reserva).toMatchObject({ estado: "confirmada", expira_en: null, monto: 11610 });
      expect(r.pago.id).toBe(t.pagoId);

      const f = await filasDe(t.usuario.id);
      expect(f.pagos).toHaveLength(pagosAntes);
      expect(f.reservas.filter((x) => x.pagoId === t.pagoId)).toHaveLength(2);
      const nueva = f.reservas.find((x) => x.id === r.reserva.id)!;
      const original = f.reservas.find((x) => x.id === t.reservaId)!;
      expect(original.estado).toBe("expirada");
      expect(nueva).toMatchObject({
        pagoId: t.pagoId,
        estado: "confirmada",
        expiraEn: null,
        membresiaId: t.membresiaId,
        tipo: original.tipo,
        dormitorios: original.dormitorios,
        banos: original.banos,
        distrito: original.distrito,
        calle: original.calle,
        numero: original.numero,
        direccionNormalizada: original.direccionNormalizada,
        precioLista: original.precioLista,
        descuento: original.descuento,
        monto: original.monto,
        primeraGratis: original.primeraGratis,
      });
      expect(Number(nueva.horasGratisAplicadas)).toBe(Number(original.horasGratisAplicadas));
    });

    it("un pago de membresía_y_reserva aprobado tarde conserva las 3 horas gratis y el monto", async () => {
      // La primera membresía con su reserva: vence, se aprueba tarde (se activa la membresía) y se elige un nuevo horario.
      const [cliente] = await esc.crearClientes(1);
      const dia = nuevoDia();
      const p = await crearPrimeraReserva(
        { usuario: cliente, cuerpo: { ...cuerpo(dia, direccionNueva()), servicio: { tipo: "profunda", dormitorios: 2, banos: 1 } }, ahora: AHORA },
        depsCrear(cliente),
      );
      await venceReserva(p.reserva.id);
      const a = await aprobar(p.pago.id);
      expect(a.nuevo_horario_pendiente).toBe(true);
      // La membresía se activó con la hora real de la aprobación; se fija un fin lejano para probar fechas de 2099.
      await base.update(membresias).set({ fin: new Date("2099-04-30T15:00:00Z") }).where(eq(membresias.id, p.membresia.id));

      const r = await nuevoHorario(cliente, p.pago.id, `${nuevoDia()}T10:00:00-05:00`);
      expect(r.reserva).toMatchObject({ estado: "confirmada", monto: 6966, horas_gratis_aplicadas: 3 });
      expect((await reservaDe(r.reserva.id)).primeraGratis).toBe(true);
      expect((await filasDe(cliente.id)).pagos).toHaveLength(1);
    });

    it("el pago de una cancelación del cliente responde 409 pago_en_credito; el de una cancelación del administrador, no", async () => {
      const cliente = await conAprobacionTardia();
      await base.update(reservas).set({ estado: "cancelada", canceladaPor: "cliente" }).where(eq(reservas.id, cliente.reservaId));
      const e = await error(nuevoHorario(cliente.usuario, cliente.pagoId, `${nuevoDia()}T10:00:00-05:00`));
      expect(e).toMatchObject({ status: 409, codigo: "pago_en_credito" });
      expect((await filasDe(cliente.usuario.id)).reservas.filter((r) => r.estado === "confirmada")).toHaveLength(0);

      const porAdmin = await conAprobacionTardia();
      await base.update(reservas).set({ estado: "cancelada", canceladaPor: "admin" }).where(eq(reservas.id, porAdmin.reservaId));
      await expect(nuevoHorario(porAdmin.usuario, porAdmin.pagoId, `${nuevoDia()}T10:00:00-05:00`)).resolves.toMatchObject({ reserva: { estado: "confirmada" } });
    });

    it("el pago de otro cliente da 404", async () => {
      const t = await conAprobacionTardia();
      const [intruso] = await esc.crearMiembros(1);
      expect(await error(nuevoHorario(intruso.usuario, t.pagoId, `${nuevoDia()}T10:00:00-05:00`))).toMatchObject({ status: 404 });
      expect(await error(leerNuevoHorario({ usuario: intruso.usuario, pagoId: t.pagoId, ahora: AHORA }, depsDatos))).toMatchObject({ status: 404 });
      expect(await error(leerDisponibilidadNuevoHorario({ usuario: intruso.usuario, pagoId: t.pagoId, fecha: "2099-02-02", ahora: AHORA }, depsDatos))).toMatchObject({ status: 404 });
    });

    it("sin cupo da 409 conflicto y el pago queda intacto; después, con cupo, funciona", async () => {
      const t = await conAprobacionTardia();
      const lleno = nuevoDia();
      await ocupar(esc.equipoIds[0], lleno, "10:00", 5);
      await ocupar(esc.equipoIds[1], lleno, "10:00", 5);
      const e = await error(nuevoHorario(t.usuario, t.pagoId, `${lleno}T10:00:00-05:00`));
      expect(e).toMatchObject({ status: 409, codigo: "conflicto" });
      expect((await pagoDe(t.pagoId)).estado).toBe("aprobado");
      expect((await filasDe(t.usuario.id)).reservas.filter((r) => r.estado === "confirmada")).toHaveLength(0);
      await expect(nuevoHorario(t.usuario, t.pagoId, `${nuevoDia()}T10:00:00-05:00`)).resolves.toMatchObject({ reserva: { estado: "confirmada" } });
    });

    it("dos peticiones simultáneas con el mismo pago: una 201 y la otra 409, con una sola reserva viva", async () => {
      const t = await conAprobacionTardia();
      const resultados = await Promise.allSettled([
        nuevoHorario(t.usuario, t.pagoId, `${nuevoDia()}T10:00:00-05:00`),
        nuevoHorario(t.usuario, t.pagoId, `${nuevoDia()}T10:00:00-05:00`),
      ]);
      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const fallo = resultados.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
      expect(fallo.reason).toMatchObject({ status: 409 });
      expect((await vivasDe(t.usuario.id)).filter((r) => r.pagoId === t.pagoId)).toHaveLength(1);
    });

    it("un inicio posterior al fin de la membresía da 422 y el pago queda intacto", async () => {
      const t = await conAprobacionTardia();
      await base.update(membresias).set({ fin: new Date("2099-01-08T15:00:00Z") }).where(eq(membresias.id, t.membresiaId));
      const e = await error(nuevoHorario(t.usuario, t.pagoId, `${nuevoDia()}T10:00:00-05:00`));
      expect(e).toMatchObject({ status: 422, message: expect.stringMatching(/renueva tu membresía/) });
      expect((await pagoDe(t.pagoId)).estado).toBe("aprobado");
    });

    it("un pago aprobado sin horario bloquea POST /api/reservas con 409 horario_pendiente y deja de bloquear al usarse", async () => {
      const t = await conAprobacionTardia();
      const e = await error(reservarMiembro(t.usuario, cuerpo(nuevoDia())));
      expect(e).toMatchObject({ status: 409, codigo: "horario_pendiente" });

      await nuevoHorario(t.usuario, t.pagoId, `${nuevoDia()}T10:00:00-05:00`);
      await expect(reservarMiembro(t.usuario, cuerpo(nuevoDia()))).resolves.toMatchObject({ reserva: { estado: "pendiente" } });
    });

    it("GET: los datos y la disponibilidad salen con las horas guardadas y el límite en el fin de la membresía", async () => {
      const t = await conAprobacionTardia({ tipo: "profunda", dormitorios: 2, banos: 1 });
      const d = await leerNuevoHorario({ usuario: t.usuario, pagoId: t.pagoId, ahora: AHORA }, depsDatos);
      expect(d).toMatchObject({
        pago: { id: t.pagoId },
        servicio: { tipo: "profunda", dormitorios: 2, banos: 1 },
        horas_agenda: 5,
        limite: "2099-04-30T10:00:00-05:00",
        fechas: { desde: "2099-01-07", hasta: "2099-04-30" },
      });
      const disp = await leerDisponibilidadNuevoHorario({ usuario: t.usuario, pagoId: t.pagoId, fecha: nuevoDia(), ahora: AHORA }, depsDatos);
      expect(disp.horarios.at(-1)).toMatchObject({ hora: "13:00" });
    });
  });
});
