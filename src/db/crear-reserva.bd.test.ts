import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "@/lib/__fixtures__/configuracion";
import { instanteLocal } from "@/lib/agenda/horario";
import { ErrorApi } from "@/lib/errores";
import { MENSAJE_MEMBRESIA_EN_REVISION, crearPrimeraReserva, type DependenciasCrear } from "@/lib/reservas/crear";
import { MENSAJE_RESERVA_EN_ESPERA } from "@/lib/reservas/unicidad";
import type { Usuario } from "@/lib/sesion";
import { membresias, pagos, reservas } from "./esquema";
import {
  PRUEBAS_BD_ACTIVAS,
  contarRastros,
  crearBasePruebas,
  crearEscenario,
  filaReserva,
  type BasePruebas,
} from "./pruebas-bd";

// Creación de la primera reserva contra la rama `pruebas` de Neon: membresía + pago + reserva en una transacción,
// capacidad por equipo y concurrencia. Corre con PRUEBAS_BD=1. Equipos de prueba INACTIVOS y fechas de 2099.
const AHORA = instanteLocal("2099-01-05", "10:00", "America/Lima"); // lunes

// Un día distinto para cada prueba (lunes a sábado desde el 12 de enero de 2099, dentro de los 3 meses de AHORA):
// los equipos son compartidos y lo confirmado en una prueba no debe estorbar a otra.
const DIAS: string[] = [];
for (let t = Date.UTC(2099, 0, 12); DIAS.length < 60; t += 86_400_000) {
  if (new Date(t).getUTCDay() !== 0) DIAS.push(new Date(t).toISOString().slice(0, 10));
}
let siguienteDia = 0;
const nuevoDia = () => DIAS[siguienteDia++];

describe.skipIf(!PRUEBAS_BD_ACTIVAS)("crear la primera reserva (Neon)", () => {
  let ctx: ReturnType<typeof crearBasePruebas>;
  let base: BasePruebas;
  let esc: Awaited<ReturnType<typeof crearEscenario>>;

  beforeAll(async () => {
    ctx = crearBasePruebas();
    base = ctx.base;
    esc = await crearEscenario(base);
  });

  afterAll(async () => {
    await esc?.limpiar();
    if (base) expect(await contarRastros(base)).toBe(0);
    await ctx?.cerrar();
  });

  const cuerpo = (dia: string, hora = "10:00", extra: Record<string, unknown> = {}) => ({
    servicio: { tipo: "profunda", dormitorios: 2, banos: 1 },
    inicio: `${dia}T${hora}:00-05:00`,
    direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123" },
    metodo: "yape",
    comprobante: "comprobante-de-prueba",
    ...extra,
  });

  const dependencias = (usuario: Usuario, equipoIds: number[]): DependenciasCrear => ({
    leerConfig: async () => VALORES_DEL_DISENO,
    verificarImagen: async () => ({ ruta: `comprobantes/${usuario.id}/bd.jpg`, tipo: "image/jpeg", tamano: 1000 }),
    base: () => base,
    equipoIds,
    numeroWhatsapp: () => null,
  });
  const dosEquipos = () => esc.equipoIds.slice(0, 2);
  const crear = (usuario: Usuario, c: unknown, equipoIds = dosEquipos()) =>
    crearPrimeraReserva({ usuario, cuerpo: c, ahora: AHORA }, dependencias(usuario, equipoIds));

  const filasDe = async (usuarioId: string) => ({
    membresias: await base.select().from(membresias).where(eq(membresias.usuarioId, usuarioId)),
    pagos: await base.select().from(pagos).where(eq(pagos.usuarioId, usuarioId)),
    reservas: await base.select().from(reservas).where(eq(reservas.usuarioId, usuarioId)),
  });
  const totalDe = async (usuarioId: string) => {
    const f = await filasDe(usuarioId);
    return f.membresias.length + f.pagos.length + f.reservas.length;
  };
  // Ocupa un equipo en un rango con una reserva de otro cliente (con su membresía y pago de prueba).
  async function ocupar(equipoId: number, dia: string, hora: string, horas: number, estado: "confirmada" | "cancelada" | "expirada" | "pendiente" = "confirmada", expiraEn?: Date) {
    const [d] = await esc.crearDuenos(1);
    const [fila] = await base
      .insert(reservas)
      .values(filaReserva({ ...d, equipoId, inicio: `${dia}T${hora}:00-05:00`, horasAgenda: horas, estado, expiraEn }))
      .returning({ id: reservas.id });
    return fila.id;
  }
  const error = async (promesa: Promise<unknown>) => {
    try {
      await promesa;
    } catch (e) {
      return e as ErrorApi;
    }
    throw new Error("se esperaba un error");
  };

  describe("camino feliz", () => {
    it("crea una membresía, un pago y una reserva pendientes, vinculados, con expira_en 24 h después", async () => {
      const [cliente] = await esc.crearClientes(1);
      const dia = nuevoDia();
      const r = await crear(cliente, cuerpo(dia));
      expect(r.reserva.estado).toBe("pendiente");

      const f = await filasDe(cliente.id);
      expect(f.membresias).toHaveLength(1);
      expect(f.pagos).toHaveLength(1);
      expect(f.reservas).toHaveLength(1);
      const [m, p, res] = [f.membresias[0], f.pagos[0], f.reservas[0]];
      expect(m).toMatchObject({ estado: "pendiente", monto: 26700, inicio: null, fin: null });
      expect(p).toMatchObject({ estado: "pendiente", concepto: "membresia_y_reserva", monto: 33666, metodo: "yape", membresiaId: m.id });
      expect(p.comprobanteRuta).toBe(`comprobantes/${cliente.id}/bd.jpg`);
      expect(res).toMatchObject({ estado: "pendiente", membresiaId: m.id, pagoId: p.id, monto: 6966, precioLista: 19350, primeraGratis: true });
      expect(Number(res.horasGratisAplicadas)).toBe(3);
      expect(res.expiraEn!.getTime() - res.creadaEn.getTime()).toBe(24 * 3_600_000);
      expect(dosEquipos()).toContain(res.equipoId);
    });

    it("una estándar de 3 h crea el pago membresia por 26700", async () => {
      const [cliente] = await esc.crearClientes(1);
      // Otro número de casa: con el mismo hogar de la prueba anterior ya no habría horas gratis (change una-limpieza-gratis-por-hogar).
      await crear(cliente, cuerpo(nuevoDia(), "10:00", { servicio: { tipo: "paquete", horas: 3 }, direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "124" } }));
      const f = await filasDe(cliente.id);
      expect(f.pagos[0]).toMatchObject({ concepto: "membresia", monto: 26700 });
      expect(f.reservas[0].monto).toBe(0);
    });
  });

  describe("capacidad", () => {
    it("con los dos equipos ocupados responde 409 y no queda ninguna membresía ni pago", async () => {
      const [cliente] = await esc.crearClientes(1);
      const dia = nuevoDia();
      await ocupar(esc.equipoIds[0], dia, "10:00", 5);
      await ocupar(esc.equipoIds[1], dia, "10:00", 5);
      const e = await error(crear(cliente, cuerpo(dia)));
      expect(e).toMatchObject({ status: 409, codigo: "conflicto" });
      expect(await totalDe(cliente.id)).toBe(0);
    });

    it("con el primero ocupado queda en el segundo; con el primero libre, en el primero", async () => {
      const [a, b] = await esc.crearClientes(2);
      const dia = nuevoDia();
      await ocupar(esc.equipoIds[0], dia, "10:00", 5);
      const r1 = await crear(a, cuerpo(dia));
      expect((await filasDe(a.id)).reservas[0].id).toBe(r1.reserva.id);
      expect((await filasDe(a.id)).reservas[0].equipoId).toBe(esc.equipoIds[1]);

      const libre = nuevoDia();
      await crear(b, cuerpo(libre));
      expect((await filasDe(b.id)).reservas[0].equipoId).toBe(esc.equipoIds[0]);
    });

    it("una reserva que empieza justo al terminar el traslado se acepta, y un minuto antes no cabe", async () => {
      const [a] = await esc.crearClientes(1);
      const dia = nuevoDia();
      await ocupar(esc.equipoIds[0], dia, "08:00", 4); // 08:00-12:00, bloquea hasta 13:00
      const un = [esc.equipoIds[0]];
      // La estándar de 1/1 dura 3 h: a las 13:00 cabe justo después del traslado.
      await crear(a, cuerpo(dia, "13:00", { servicio: { tipo: "estandar", dormitorios: 1, banos: 1 } }), un);
      expect((await filasDe(a.id)).reservas).toHaveLength(1);
      // A las 12:30 todavía está en el traslado: no hay equipo (y no queda nada para el segundo cliente).
      const [b] = await esc.crearClientes(1);
      const e = await error(crear(b, cuerpo(dia, "12:30", { servicio: { tipo: "estandar", dormitorios: 1, banos: 1 } }), un));
      expect(e).toMatchObject({ status: 409, codigo: "conflicto" });
      expect(await totalDe(b.id)).toBe(0);
    });

    it.each(["cancelada", "expirada"] as const)("una reserva %s libera el cupo", async (estado) => {
      const [cliente] = await esc.crearClientes(1);
      const dia = nuevoDia();
      await ocupar(esc.equipoIds[0], dia, "10:00", 5, estado);
      await crear(cliente, cuerpo(dia), [esc.equipoIds[0]]);
      expect((await filasDe(cliente.id)).reservas).toHaveLength(1);
    });
  });

  describe("concurrencia", () => {
    it("dos clientes distintos por el último cupo: uno gana (201) y otro recibe 409; solo el ganador tiene membresía y pago", async () => {
      const [a, b] = await esc.crearClientes(2);
      const dia = nuevoDia();
      const un = [esc.equipoIds[0]];
      const resultados = await Promise.allSettled([crear(a, cuerpo(dia), un), crear(b, cuerpo(dia), un)]);
      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const perdedora = resultados.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
      expect(perdedora.reason).toMatchObject({ status: 409, codigo: "conflicto" });
      const totales = [await totalDe(a.id), await totalDe(b.id)].sort();
      expect(totales).toEqual([0, 3]);
    });

    it("dos peticiones simultáneas del mismo cliente: una 201 y una 409; una sola membresía, un pago y una reserva", async () => {
      const [cliente] = await esc.crearClientes(1);
      const [d1, d2] = [nuevoDia(), nuevoDia()];
      const resultados = await Promise.allSettled([crear(cliente, cuerpo(d1)), crear(cliente, cuerpo(d2))]);
      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const perdedora = resultados.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
      expect(perdedora.reason).toMatchObject({ status: 409, codigo: "en_espera" });
      const f = await filasDe(cliente.id);
      expect([f.membresias.length, f.pagos.length, f.reservas.length]).toEqual([1, 1, 1]);
    });

    it("diez clientes por un solo cupo: exactamente uno gana", async () => {
      const clientes = await esc.crearClientes(10);
      const dia = nuevoDia();
      const un = [esc.equipoIds[2]];
      const resultados = await Promise.allSettled(clientes.map((c) => crear(c, cuerpo(dia), un)));
      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of resultados) if (r.status === "rejected") expect(r.reason).toMatchObject({ status: 409 });
      const totales = await Promise.all(clientes.map((c) => totalDe(c.id)));
      expect(totales.filter((t) => t === 3)).toHaveLength(1);
      expect(totales.filter((t) => t === 0)).toHaveLength(9);
    });
  });

  describe("reservas vencidas y estado del cliente", () => {
    it("una pendiente vencida de otro cliente no impide reservar su horario y queda expirada", async () => {
      const [cliente] = await esc.crearClientes(1);
      const dia = nuevoDia();
      const vencida = await ocupar(esc.equipoIds[0], dia, "10:00", 5, "pendiente", new Date(Date.now() - 3_600_000));
      await crear(cliente, cuerpo(dia), [esc.equipoIds[0]]);
      expect((await filasDe(cliente.id)).reservas).toHaveLength(1);
      const [anterior] = await base.select({ estado: reservas.estado }).from(reservas).where(inArray(reservas.id, [vencida]));
      expect(anterior.estado).toBe("expirada");
    });

    it("un cliente con la reserva vencida y su membresía todavía pendiente recibe 409 de pago en revisión", async () => {
      const [cliente] = await esc.crearClientes(1);
      await crear(cliente, cuerpo(nuevoDia()));
      await base.update(reservas).set({ expiraEn: new Date(Date.now() - 3_600_000) }).where(eq(reservas.usuarioId, cliente.id));
      const e = await error(crear(cliente, cuerpo(nuevoDia())));
      expect(e).toMatchObject({ status: 409, codigo: "en_espera", message: MENSAJE_MEMBRESIA_EN_REVISION });
      const f = await filasDe(cliente.id);
      // El 409 deshace la transacción entera, también la marca de expirada: la vencida se marca en la siguiente escritura que sí se confirme.
      expect([f.membresias.length, f.pagos.length, f.reservas.length]).toEqual([1, 1, 1]);
    });

    it("un cliente con una reserva pendiente vigente recibe 409 de reserva en espera", async () => {
      const [cliente] = await esc.crearClientes(1);
      await crear(cliente, cuerpo(nuevoDia()));
      const e = await error(crear(cliente, cuerpo(nuevoDia())));
      expect(e).toMatchObject({ status: 409, codigo: "en_espera", message: MENSAJE_RESERVA_EN_ESPERA });
      expect(await totalDe(cliente.id)).toBe(3);
    });
  });
});
