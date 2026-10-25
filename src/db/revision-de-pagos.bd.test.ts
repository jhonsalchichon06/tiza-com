import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "@/lib/__fixtures__/configuracion";
import { instanteLocal } from "@/lib/agenda/horario";
import { ejecutarPasadaDeExpiracion } from "@/lib/agenda/pasada";
import { validarDireccion } from "@/lib/direccion";
import { ErrorApi } from "@/lib/errores";
import { buscarCoincidencias } from "@/lib/pagos/coincidencias";
import { pagosConHorarioPendiente } from "@/lib/pagos/horario-pendiente";
import { listarPagos } from "@/lib/pagos/listado";
import { reenviarComprobante, type DependenciasReenvio } from "@/lib/pagos/reenvio";
import { aprobarPago, rechazarPago, type DependenciasRevision } from "@/lib/pagos/revision";
import { cancelarReservaComoAdmin } from "@/lib/reservas/cancelar-admin";
import { crearPrimeraReserva, type DependenciasCrear } from "@/lib/reservas/crear";
import type { Usuario } from "@/lib/sesion";
import { configuracion, membresias, pagos, reservas } from "./esquema";
import { PRUEBAS_BD_ACTIVAS, contarRastros, crearBasePruebas, crearEscenario, filaReserva, type BasePruebas } from "./pruebas-bd";

// Revisión de pagos contra la rama `pruebas` de Neon (change revision-de-pagos-admin): aprobar, rechazar, aprobación
// tardía, reenvío con plazo, cierre de membresías, cancelación del administrador, coincidencias y concurrencia.
// Corre con PRUEBAS_BD=1. Equipos de prueba INACTIVOS y fechas de 2099; el reloj de los plazos es el de la base.
const AHORA = instanteLocal("2099-01-05", "10:00", "America/Lima"); // lunes

// Un día distinto para cada reserva (lunes a sábado desde el 12 de enero de 2099, dentro de los 3 meses de AHORA).
const DIAS: string[] = [];
for (let t = Date.UTC(2099, 0, 12); DIAS.length < 70; t += 86_400_000) {
  if (new Date(t).getUTCDay() !== 0) DIAS.push(new Date(t).toISOString().slice(0, 10));
}
let siguienteDia = 0;
const nuevoDia = () => DIAS[siguienteDia++];

const HORA = 3_600_000;

describe.skipIf(!PRUEBAS_BD_ACTIVAS)("revisión de pagos (Neon)", () => {
  let ctx: ReturnType<typeof crearBasePruebas>;
  let base: BasePruebas;
  let esc: Awaited<ReturnType<typeof crearEscenario>>;
  let admin: { id: string };
  let numeroDeCasa = 300;

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
  const depsCrear = (usuario: Usuario): DependenciasCrear => ({
    leerConfig: async () => VALORES_DEL_DISENO,
    verificarImagen: async () => ({ ruta: `comprobantes/${usuario.id}/bd.jpg`, tipo: "image/jpeg", tamano: 1000 }),
    base: () => base,
    equipoIds: dosEquipos(),
    numeroWhatsapp: () => null,
  });
  const depsRevision: DependenciasRevision = { base: () => base, leerConfig: async () => VALORES_DEL_DISENO };
  const depsReenvio = (usuario: Usuario, dias = VALORES_DEL_DISENO.reenvio_comprobante_dias): DependenciasReenvio => ({
    leerConfig: async () => ({ ...VALORES_DEL_DISENO, reenvio_comprobante_dias: dias }),
    verificarImagen: async () => ({ ruta: `comprobantes/${usuario.id}/reenvio-${crypto.randomUUID().slice(0, 6)}.jpg`, tipo: "image/jpeg", tamano: 1000 }),
    base: () => base,
  });
  const pasada = (dias = VALORES_DEL_DISENO.reenvio_comprobante_dias) => ejecutarPasadaDeExpiracion(base, async () => ({ reenvio_comprobante_dias: dias }));

  const aprobar = (pagoId: string) => aprobarPago({ admin, pagoId }, depsRevision);
  const rechazar = (pagoId: string, motivo?: string) => rechazarPago({ admin, pagoId, cuerpo: motivo === undefined ? undefined : { motivo } }, depsRevision);
  const reenviar = (usuario: Usuario, pagoId: string, dias?: number) =>
    reenviarComprobante({ usuario, cuerpo: { pago_id: pagoId, metodo: "transferencia", comprobante: `comprobantes/${usuario.id}/nuevo.jpg` } }, depsReenvio(usuario, dias));

  const error = async (promesa: Promise<unknown>) => {
    try {
      await promesa;
    } catch (e) {
      return e as ErrorApi;
    }
    throw new Error("se esperaba un error");
  };
  const codigoSql = async (promesa: Promise<unknown>): Promise<string> => {
    try {
      await promesa;
      return "ok";
    } catch (e) {
      const x = e as { code?: string; cause?: { code?: string } };
      return x.cause?.code ?? x.code ?? "error";
    }
  };

  const cuerpo = (dia: string, direccion: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    servicio: { tipo: "profunda", dormitorios: 2, banos: 1 },
    inicio: `${dia}T10:00:00-05:00`,
    direccion,
    metodo: "yape",
    comprobante: "comprobante-de-prueba",
    ...extra,
  });
  const direccionNueva = () => ({ distrito: "Miraflores", calle: "Av. Pruebas Sol", numero: String(numeroDeCasa++) });

  // Un cliente con su primera reserva pendiente, creada por el flujo real (membresía, pago y reserva).
  async function casoNuevo(dia = nuevoDia(), direccion: Record<string, unknown> = direccionNueva()) {
    const [cliente] = await esc.crearClientes(1);
    const r = await crearPrimeraReserva({ usuario: cliente, cuerpo: cuerpo(dia, direccion), ahora: AHORA }, depsCrear(cliente));
    return { cliente, dia, direccion, pagoId: r.pago.id, reservaId: r.reserva.id, membresiaId: r.membresia.id };
  }
  type Caso = Awaited<ReturnType<typeof casoNuevo>>;

  const venceReserva = (reservaId: string) =>
    base.update(reservas).set({ expiraEn: sql`now() - interval '1 hour'` }).where(eq(reservas.id, reservaId));
  const pagoDe = async (id: string) => (await base.select().from(pagos).where(eq(pagos.id, id)))[0];
  const membresiaDe = async (id: string) => (await base.select().from(membresias).where(eq(membresias.id, id)))[0];
  const reservaDe = async (id: string) => (await base.select().from(reservas).where(eq(reservas.id, id)))[0];
  const pagosDeMembresia = (membresiaId: string) => base.select().from(pagos).where(eq(pagos.membresiaId, membresiaId));

  // Ocupa un equipo en un rango con una reserva de otro cliente.
  async function ocupar(equipoId: number, dia: string, hora: string, horas: number) {
    const [d] = await esc.crearDuenos(1);
    await base.insert(reservas).values(filaReserva({ ...d, equipoId, inicio: `${dia}T${hora}:00-05:00`, horasAgenda: horas, estado: "confirmada" }));
  }

  describe("aprobar", () => {
    it("pago membresia_y_reserva: pago aprobado, membresía activa por 3 meses y reserva confirmada sin expira_en", async () => {
      const c = await casoNuevo();
      const r = await aprobar(c.pagoId);
      expect(r.nuevo_horario_pendiente).toBe(false);

      expect(await pagoDe(c.pagoId)).toMatchObject({ estado: "aprobado", revisadoPor: admin.id });
      const m = await membresiaDe(c.membresiaId);
      expect(m.estado).toBe("activa");
      const [{ tres_meses }] = await base.execute<{ tres_meses: boolean }>(
        sql`SELECT (fin = inicio + make_interval(months => 3)) AS tres_meses FROM membresias WHERE id = ${c.membresiaId}`,
      ).then((x) => x.rows);
      expect(tres_meses).toBe(true);
      expect(await reservaDe(c.reservaId)).toMatchObject({ estado: "confirmada", expiraEn: null });
    });

    it("la vigencia parte de la aprobación y no de la creación del pago (pago creado 30 horas antes)", async () => {
      const c = await casoNuevo();
      await base.update(pagos).set({ creadoEn: sql`now() - interval '30 hours'` }).where(eq(pagos.id, c.pagoId));
      await aprobar(c.pagoId);
      const m = await membresiaDe(c.membresiaId);
      expect(Math.abs(m.inicio!.getTime() - Date.now())).toBeLessThan(5 * 60_000);
    });

    it("el CHECK pagos_revision_coherente rechaza un pago rechazado sin revisor", async () => {
      const c = await casoNuevo();
      const codigo = await codigoSql(base.update(pagos).set({ estado: "rechazado" }).where(eq(pagos.id, c.pagoId)));
      expect(codigo).toBe("23514");
    });

    it("una reserva pendiente vencida de otro cliente queda expirada al aprobar", async () => {
      const a = await casoNuevo();
      const b = await casoNuevo();
      await venceReserva(b.reservaId);
      await aprobar(a.pagoId);
      expect((await reservaDe(b.reservaId)).estado).toBe("expirada");
    });
  });

  describe("pasada de expiración", () => {
    it("una pendiente vencida queda expirada tras la pasada aunque otra transacción posterior falle con 409", async () => {
      const aprobado = await casoNuevo();
      await aprobar(aprobado.pagoId);
      const vencida = await casoNuevo();
      await venceReserva(vencida.reservaId);

      // Una escritura que falla deshace su propia marca (comportamiento previo, documentado en el design).
      const e = await error(aprobar(aprobado.pagoId));
      expect(e).toMatchObject({ status: 409 });
      expect((await reservaDe(vencida.reservaId)).estado).toBe("pendiente");

      // La pasada, en su propia transacción, la confirma, y un 409 posterior ya no la deshace.
      const { reservas: marcadas } = await pasada();
      expect(marcadas).toContain(vencida.reservaId);
      expect((await reservaDe(vencida.reservaId)).estado).toBe("expirada");
      await error(aprobar(aprobado.pagoId));
      expect((await reservaDe(vencida.reservaId)).estado).toBe("expirada");
    });

    it("la lista nunca muestra como pendiente una reserva vencida sin marcar", async () => {
      const c = await casoNuevo();
      await venceReserva(c.reservaId);
      const lista = await listarPagos(base, { estado: "pendiente" }, VALORES_DEL_DISENO);
      const elemento = lista.find((x) => x.pago.id === c.pagoId);
      expect(elemento?.reserva?.estado).toBe("expirada");
    });
  });

  describe("aprobación tardía", () => {
    it("con la reserva expirada: pago aprobado, membresía activa, reserva intacta y horario liberado para otro cliente", async () => {
      const dia = nuevoDia();
      const a = await casoNuevo(dia);
      await venceReserva(a.reservaId);
      // Con la reserva de A viva y el otro equipo ocupado, el horario no tendría cupo; vencida, sí.
      const r = await aprobar(a.pagoId);
      expect(r.nuevo_horario_pendiente).toBe(true);
      expect(r.reserva).toMatchObject({ estado: "expirada" });
      expect((await membresiaDe(a.membresiaId)).estado).toBe("activa");
      expect((await reservaDe(a.reservaId)).estado).toBe("expirada");

      // Otro cliente ocupa ese horario y la aprobación tardía no lo afecta.
      await ocupar(esc.equipoIds[1], dia, "10:00", 5);
      const [otro] = await esc.crearClientes(1);
      const b = await crearPrimeraReserva({ usuario: otro, cuerpo: cuerpo(dia, direccionNueva()), ahora: AHORA }, depsCrear(otro));
      expect(b.reserva.estado).toBe("pendiente");
      expect((await reservaDe(a.reservaId)).estado).toBe("expirada");
    });

    it("pagosConHorarioPendiente devuelve ese pago y no el de una reserva confirmada", async () => {
      const tardio = await casoNuevo();
      await venceReserva(tardio.reservaId);
      await aprobar(tardio.pagoId);
      const normal = await casoNuevo();
      await aprobar(normal.pagoId);

      const pendientes = await pagosConHorarioPendiente(base, tardio.cliente.id);
      expect(pendientes.map((p) => p.id)).toEqual([tardio.pagoId]);
      expect(await pagosConHorarioPendiente(base, normal.cliente.id)).toEqual([]);
    });
  });

  describe("rechazar y reenviar", () => {
    it("rechazar deja la reserva pendiente con su expira_en y devuelve reenvio_hasta a 7 días", async () => {
      const c = await casoNuevo();
      const antes = await reservaDe(c.reservaId);
      const r = await rechazar(c.pagoId, "Imagen borrosa");
      expect(r.pago).toMatchObject({ estado: "rechazado", motivo_rechazo: "Imagen borrosa" });
      const despues = await reservaDe(c.reservaId);
      expect(despues.estado).toBe("pendiente");
      expect(despues.expiraEn!.getTime()).toBe(antes.expiraEn!.getTime());
      const p = await pagoDe(c.pagoId);
      // La respuesta escribe la hora al minuto (isoConZona), así que la diferencia con el instante exacto es menor a 1 minuto.
      const diferencia = 7 * 24 * HORA - (new Date(r.reenvio_hasta!).getTime() - p.revisadoEn!.getTime());
      expect(diferencia).toBeGreaterThanOrEqual(0);
      expect(diferencia).toBeLessThan(60_000);
      expect(r.reenvio_vigente).toBe(true);
    });

    it("reenviar apunta la reserva al pago nuevo sin cambiar su expira_en", async () => {
      const c = await casoNuevo();
      const antes = await reservaDe(c.reservaId);
      await rechazar(c.pagoId);
      const r = await reenviar(c.cliente, c.pagoId);
      expect(r.pago).toMatchObject({ estado: "pendiente", reemplaza_a: c.pagoId, monto: (await pagoDe(c.pagoId)).monto });
      const despues = await reservaDe(c.reservaId);
      expect(despues.pagoId).toBe(r.pago.id);
      expect(despues.expiraEn!.getTime()).toBe(antes.expiraEn!.getTime());
    });

    it("con la reserva expirada y el rechazo de hace 3 días: pago nuevo sin reserva; al aprobarlo la membresía se activa y el horario queda pendiente", async () => {
      const c = await casoNuevo();
      await venceReserva(c.reservaId);
      await esc.rechazarHace(c.pagoId, admin.id, 72);
      const r = await reenviar(c.cliente, c.pagoId);
      expect(r.reserva).toBeNull();

      const ap = await aprobar(r.pago.id);
      expect(ap.membresia).toMatchObject({ estado: "activa" });
      expect(ap.nuevo_horario_pendiente).toBe(true);
      const pendientes = await pagosConHorarioPendiente(base, c.cliente.id);
      expect(pendientes.map((p) => p.id)).toContain(r.pago.id);
    });

    it("dos reenvíos simultáneos del mismo pago: uno 201 y otro 409; el índice único lo respalda", async () => {
      const c = await casoNuevo();
      await rechazar(c.pagoId);
      const resultados = await Promise.allSettled([reenviar(c.cliente, c.pagoId), reenviar(c.cliente, c.pagoId)]);
      expect(resultados.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const falla = resultados.find((x) => x.status === "rejected") as PromiseRejectedResult;
      expect(falla.reason).toMatchObject({ status: 409 });
      const reemplazos = (await pagosDeMembresia(c.membresiaId)).filter((p) => p.reemplazaA === c.pagoId);
      expect(reemplazos).toHaveLength(1);

      // El índice impide un segundo reemplazo aunque se salte la lógica.
      const codigo = await codigoSql(
        base.insert(pagos).values({
          usuarioId: c.cliente.id,
          concepto: "membresia_y_reserva",
          membresiaId: c.membresiaId,
          monto: 1,
          metodo: "yape",
          comprobanteRuta: `comprobantes/${c.cliente.id}/x.jpg`,
          reemplazaA: c.pagoId,
        }),
      );
      expect(codigo).toBe("23505");
    });
  });

  describe("plazo de reenvío y cierre de la membresía", () => {
    // Pago rechazado hace `horas` horas, con la reserva ya expirada (el plazo largo solo aplica sin reserva viva).
    async function rechazadoHace(horas: number): Promise<Caso> {
      const c = await casoNuevo();
      await venceReserva(c.reservaId);
      await esc.rechazarHace(c.pagoId, admin.id, horas);
      return c;
    }

    it("a 6 días y 23 horas: el reenvío da 201 y la pasada no cierra la membresía", async () => {
      const c = await rechazadoHace(7 * 24 - 1);
      const { membresias: cerradas } = await pasada();
      expect(cerradas).not.toContain(c.membresiaId);
      const r = await reenviar(c.cliente, c.pagoId);
      expect(r.pago.estado).toBe("pendiente");
      expect((await membresiaDe(c.membresiaId)).estado).toBe("pendiente");
    });

    it("a 8 días: el reenvío da 409 plazo_vencido y la pasada deja la membresía caducada sin fechas y sin tocar pagos ni reservas", async () => {
      const c = await rechazadoHace(8 * 24);
      const e = await error(reenviar(c.cliente, c.pagoId));
      expect(e).toMatchObject({ status: 409, codigo: "plazo_vencido" });

      const pagosAntes = await pagosDeMembresia(c.membresiaId);
      const reservaAntes = await reservaDe(c.reservaId);
      const { membresias: cerradas } = await pasada();
      expect(cerradas).toContain(c.membresiaId);
      expect(await membresiaDe(c.membresiaId)).toMatchObject({ estado: "caducada", inicio: null, fin: null });
      expect(await pagosDeMembresia(c.membresiaId)).toEqual(pagosAntes);
      // La pasada también marca la reserva vencida como expirada; el cierre de la membresía no cambia nada más en ella.
      const reservaDespues = await reservaDe(c.reservaId);
      expect(reservaDespues).toMatchObject({ estado: "expirada", pagoId: reservaAntes.pagoId, monto: reservaAntes.monto, membresiaId: c.membresiaId });

      // Con la membresía ya caducada, incluso un plazo largo responde plazo_vencido.
      expect(await error(reenviar(c.cliente, c.pagoId, 30))).toMatchObject({ status: 409, codigo: "plazo_vencido" });
    });

    it("con un pago pendiente de reenvío la membresía no se cierra aunque el rechazado tenga 8 días", async () => {
      const c = await casoNuevo();
      await venceReserva(c.reservaId);
      await esc.rechazarHace(c.pagoId, admin.id, 5 * 24);
      const r = await reenviar(c.cliente, c.pagoId); // dentro del plazo
      expect(r.pago.estado).toBe("pendiente");
      await esc.rechazarHace(c.pagoId, admin.id, 8 * 24); // el rechazado original queda viejo
      const { membresias: cerradas } = await pasada();
      expect(cerradas).not.toContain(c.membresiaId);
      expect((await membresiaDe(c.membresiaId)).estado).toBe("pendiente");
    });

    it("cambiar reenvio_comprobante_dias en la rama cambia el resultado sin tocar el código", async () => {
      const c = await rechazadoHace(30); // 30 horas: dentro de 7 días, fuera de 1 día
      expect((await pasada(7)).membresias).not.toContain(c.membresiaId);

      await base.update(configuracion).set({ valor: 1 }).where(eq(configuracion.clave, "reenvio_comprobante_dias"));
      try {
        // Solo se lee la clave que este change agrega: la rama puede tener otras claves de ítems en curso.
        const [fila] = await base.select({ valor: configuracion.valor }).from(configuracion).where(eq(configuracion.clave, "reenvio_comprobante_dias"));
        const config = { ...VALORES_DEL_DISENO, reenvio_comprobante_dias: fila.valor as number };
        expect(config.reenvio_comprobante_dias).toBe(1);
        const { membresias: cerradas } = await ejecutarPasadaDeExpiracion(base, async () => config);
        expect(cerradas).toContain(c.membresiaId);
      } finally {
        await base.update(configuracion).set({ valor: 7 }).where(eq(configuracion.clave, "reenvio_comprobante_dias"));
      }
      const [fila] = await base.select().from(configuracion).where(eq(configuracion.clave, "reenvio_comprobante_dias"));
      expect(fila).toMatchObject({ valor: 7, provisional: false });
    });

    it("el CHECK de membresías acepta caducada sin fechas y rechaza caducada con fechas y activa sin fechas", async () => {
      const c = await casoNuevo();
      expect(await codigoSql(base.update(membresias).set({ estado: "caducada" }).where(eq(membresias.id, c.membresiaId)))).toBe("ok");
      expect(
        await codigoSql(
          base.update(membresias).set({ estado: "caducada", inicio: sql`now()`, fin: sql`now() + interval '1 day'` }).where(eq(membresias.id, c.membresiaId)),
        ),
      ).toBe("23514");
      expect(await codigoSql(base.update(membresias).set({ estado: "activa" }).where(eq(membresias.id, c.membresiaId)))).toBe("23514");
    });
  });

  describe("empezar de nuevo y carreras", () => {
    it("con la membresía caducada, crearPrimeraReserva crea membresía, pago y reserva nuevos", async () => {
      const c = await casoNuevo();
      await venceReserva(c.reservaId);
      await esc.rechazarHace(c.pagoId, admin.id, 8 * 24);
      await pasada();
      expect((await membresiaDe(c.membresiaId)).estado).toBe("caducada");

      const nueva = await crearPrimeraReserva({ usuario: c.cliente, cuerpo: cuerpo(nuevoDia(), c.direccion), ahora: AHORA }, depsCrear(c.cliente));
      expect(nueva.membresia.estado).toBe("pendiente");
      expect(nueva.membresia.id).not.toBe(c.membresiaId);
      expect(nueva.reserva.estado).toBe("pendiente");
    });

    it("con el plazo vencido y sin marcar, la misma petición cierra y deja empezar de nuevo", async () => {
      const c = await casoNuevo();
      await venceReserva(c.reservaId);
      await esc.rechazarHace(c.pagoId, admin.id, 8 * 24);
      const nueva = await crearPrimeraReserva({ usuario: c.cliente, cuerpo: cuerpo(nuevoDia(), c.direccion), ahora: AHORA }, depsCrear(c.cliente));
      expect(nueva.membresia.id).not.toBe(c.membresiaId);
      expect((await membresiaDe(c.membresiaId)).estado).toBe("caducada");
    });

    it("dentro del plazo responde 409 pago_rechazado", async () => {
      const c = await casoNuevo();
      await venceReserva(c.reservaId);
      await esc.rechazarHace(c.pagoId, admin.id, 24);
      const e = await error(crearPrimeraReserva({ usuario: c.cliente, cuerpo: cuerpo(nuevoDia(), c.direccion), ahora: AHORA }, depsCrear(c.cliente)));
      expect(e).toMatchObject({ status: 409, codigo: "pago_rechazado", message: expect.stringMatching(/antes del \d+ de \w+ de \d{4}/) });
    });

    it("un reenvío y el cierre simultáneos nunca dejan una membresía caducada con un pago pendiente", async () => {
      for (let i = 0; i < 4; i++) {
        const c = await casoNuevo();
        await venceReserva(c.reservaId);
        // Justo en el borde del plazo: el reenvío todavía puede ganar, el cierre puede llegar a verlo vencido.
        await base.update(pagos).set({ estado: "rechazado", revisadoPor: admin.id, revisadoEn: sql`now() - make_interval(secs => ${7 * 24 * 3600 - 0.4})` }).where(eq(pagos.id, c.pagoId));
        const [reenvio] = await Promise.allSettled([reenviar(c.cliente, c.pagoId), pasada()]);

        const membresia = await membresiaDe(c.membresiaId);
        const pendientes = (await pagosDeMembresia(c.membresiaId)).filter((p) => p.estado === "pendiente");
        expect(membresia.estado === "caducada" && pendientes.length > 0).toBe(false);
        if (membresia.estado === "caducada") {
          expect(reenvio.status).toBe("rejected");
          expect((reenvio as PromiseRejectedResult).reason).toMatchObject({ status: 409, codigo: "plazo_vencido" });
        } else {
          expect(membresia.estado).toBe("pendiente");
          expect(reenvio.status === "fulfilled" ? pendientes.length : 0).toBe(reenvio.status === "fulfilled" ? 1 : 0);
        }
      }
    });
  });

  describe("cancelar como administrador", () => {
    it("una pendiente pasa a cancelada con cancelada_por admin y otro cliente puede reservar ese horario de inmediato", async () => {
      const dia = nuevoDia();
      const a = await casoNuevo(dia);
      await ocupar(esc.equipoIds[1], dia, "10:00", 5);

      const [otro] = await esc.crearClientes(1);
      const intento = () => crearPrimeraReserva({ usuario: otro, cuerpo: cuerpo(dia, direccionNueva()), ahora: AHORA }, depsCrear(otro));
      expect(await error(intento())).toMatchObject({ status: 409, codigo: "conflicto" });

      const r = await cancelarReservaComoAdmin({ reservaId: a.reservaId }, { base: () => base });
      expect(r.reserva).toMatchObject({ estado: "cancelada", cancelada_por: "admin" });
      expect((await pagoDe(a.pagoId)).estado).toBe("pendiente"); // el pago no se toca
      expect((await intento()).reserva.estado).toBe("pendiente");
    });

    it("el CHECK rechaza cancelada_por en una reserva confirmada", async () => {
      const c = await casoNuevo();
      await aprobar(c.pagoId);
      expect(await codigoSql(base.update(reservas).set({ canceladaPor: "admin" }).where(eq(reservas.id, c.reservaId)))).toBe("23514");
    });

    it("una expirada o una confirmada dan 409", async () => {
      const expirada = await casoNuevo();
      await venceReserva(expirada.reservaId);
      expect(await error(cancelarReservaComoAdmin({ reservaId: expirada.reservaId }, { base: () => base }))).toMatchObject({ status: 409 });

      const confirmada = await casoNuevo();
      await aprobar(confirmada.pagoId);
      expect(await error(cancelarReservaComoAdmin({ reservaId: confirmada.reservaId }, { base: () => base }))).toMatchObject({ status: 409 });
    });
  });

  describe("coincidencias de dirección", () => {
    // Una reserva gratis de otro cliente, en el estado dado y con la dirección escrita tal cual.
    async function gratisAjena(direccion: { distrito: string; calle: string; numero: string; departamento?: string }, estado: "confirmada" | "cancelada" | "expirada" = "confirmada") {
      const v = validarDireccion(direccion);
      const [d] = await esc.crearDuenos(1);
      await base.insert(reservas).values({
        ...filaReserva({
          ...d,
          equipoId: esc.equipoIds[2],
          inicio: `${nuevoDia()}T10:00:00-05:00`,
          horasAgenda: 3,
          estado,
          primeraGratis: true,
          distrito: v.distrito,
          calle: v.calle,
          numero: v.numero,
          direccionNormalizada: v.direccionNormalizada,
          departamentoNormalizado: v.departamentoNormalizado,
        }),
        departamento: v.departamento,
      });
    }

    it("solo aparecen la otra unidad del edificio y la calle parecida del mismo distrito; no otro distrito, ni canceladas, ni expiradas", async () => {
      const numero = String(numeroDeCasa++);
      const base1 = { calle: "Av. Pruebas Sol", numero };
      const c = await casoNuevo(nuevoDia(), { distrito: "Miraflores", ...base1 });

      await gratisAjena({ distrito: "Miraflores", ...base1, departamento: "Dpto. 101" }); // otro_departamento
      await gratisAjena({ distrito: "Miraflores", calle: "Pruebas Sol", numero }); // calle_parecida
      await gratisAjena({ distrito: "Barranco", ...base1 }); // otro distrito
      await gratisAjena({ distrito: "Miraflores", calle: "Av. Pruebas Sol", numero, departamento: "Dpto. 202" }, "cancelada");
      await gratisAjena({ distrito: "Miraflores", calle: "Av. Pruebas Sol", numero, departamento: "Dpto. 303" }, "expirada");

      const r = await buscarCoincidencias(base, c.membresiaId);
      expect(r.aplica).toBe(true);
      expect(r.coincidencias.map((x) => x.nivel)).toEqual(["otro_departamento", "calle_parecida"]);
      expect(r.coincidencias.every((x) => x.distrito === "Miraflores")).toBe(true);
    });
  });

  describe("concurrencia de la revisión", () => {
    it("dos aprobaciones simultáneas del mismo pago: una gana y la otra recibe 409, con una sola fecha de inicio", async () => {
      const c = await casoNuevo();
      const resultados = await Promise.allSettled([aprobar(c.pagoId), aprobar(c.pagoId)]);
      expect(resultados.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const falla = resultados.find((x) => x.status === "rejected") as PromiseRejectedResult;
      expect(falla.reason).toMatchObject({ status: 409 });

      const ganadora = resultados.find((x) => x.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof aprobar>>>;
      const m = await membresiaDe(c.membresiaId);
      // La respuesta escribe la hora al minuto (isoConZona); la base guarda microsegundos.
      const diferencia = m.inicio!.getTime() - new Date(ganadora.value.membresia!.inicio!).getTime();
      expect(diferencia).toBeGreaterThanOrEqual(0);
      expect(diferencia).toBeLessThan(60_000);
    });

    it("aprobar y rechazar a la vez: exactamente una gana", async () => {
      const c = await casoNuevo();
      const resultados = await Promise.allSettled([aprobar(c.pagoId), rechazar(c.pagoId)]);
      expect(resultados.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const falla = resultados.find((x) => x.status === "rejected") as PromiseRejectedResult;
      expect(falla.reason).toMatchObject({ status: 409 });
      expect(["aprobado", "rechazado"]).toContain((await pagoDe(c.pagoId)).estado);
    });
  });
});
