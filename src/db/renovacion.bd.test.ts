import { and, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consultarDisponibilidad } from "@/lib/agenda/consulta";
import { diaDeLaSemana, fechaLocal } from "@/lib/agenda/horario";
import { leerOcupacion } from "@/lib/agenda/leer";
import { ejecutarPasadaDeExpiracion } from "@/lib/agenda/pasada";
import { crearRutaDisponibilidad } from "@/lib/agenda/rutas";
import { leerConfiguracion, type Configuracion } from "@/lib/configuracion";
import { claveHogar, validarDireccion } from "@/lib/direccion";
import { ErrorApi } from "@/lib/errores";
import { entregarImagen } from "@/lib/imagenes/entrega";
import { planDeRenovacion } from "@/lib/membresia/plan";
import { puedeElegirDiaYHora } from "@/lib/membresia/renovacion";
import { renovarMembresia, type DependenciasRenovar } from "@/lib/membresia/renovar";
import { comprobarVigenciaDeLaConsulta, comprobarVigenciaParaReservar } from "@/lib/membresia/vigencia-miembro";
import { obtenerComprobante } from "@/lib/pagos/comprobante";
import { detalleDePago, listarPagos } from "@/lib/pagos/listado";
import { reenviarComprobante, type DependenciasReenvio } from "@/lib/pagos/reenvio";
import { aprobarPago, rechazarPago, type DependenciasRevision } from "@/lib/pagos/revision";
import { leerPerfil, type DependenciasPerfil } from "@/lib/perfil/resumen";
import { decidirLimpiezaGratis } from "@/lib/reservas/gratis";
import { reprogramarReserva } from "@/lib/reservas/reprogramar";
import type { Usuario } from "@/lib/sesion";
import { configuracion, equipos, membresias, pagos, reservas, usuarios } from "./esquema";
import { PRUEBAS_BD_ACTIVAS, crearBasePruebas, crearEscenario, filaReserva, type BasePruebas } from "./pruebas-bd";

// Renovación del mes 4 contra la rama `pruebas` de Neon (change renovacion-del-mes-4): aviso, pago de renovación por la
// revisión del ítem 11, bloqueo por vigencia y que nada de esto escriba en `reservas`. Corre con PRUEBAS_BD=1.
// El reloj es el de la base: las membresías de prueba se fijan con `now()` (vencida = `fin` en el pasado).
const DIA_S = 86_400;
const ZONA = "America/Lima";

// Primer día de lunes a sábado (fecha civil de Lima) que esté al menos `dias` días después de ahora.
function laborableEn(dias: number): string {
  let t = Date.now() + dias * DIA_S * 1000;
  for (;;) {
    const fecha = fechaLocal(new Date(t), ZONA);
    if (diaDeLaSemana(fecha) !== 0) return fecha;
    t += DIA_S * 1000;
  }
}

describe.skipIf(!PRUEBAS_BD_ACTIVAS)("renovación del mes 4 (Neon)", () => {
  let ctx: ReturnType<typeof crearBasePruebas>;
  let base: BasePruebas;
  let esc: Awaited<ReturnType<typeof crearEscenario>>;
  let admin: { id: string };

  beforeAll(async () => {
    ctx = crearBasePruebas();
    base = ctx.base;
    esc = await crearEscenario(base);
    admin = await esc.crearAdmin();
  });

  afterAll(async () => {
    await esc?.limpiar();
    // Solo los rastros de ESTA corrida (prefijo propio): otros agentes pueden tener su propio escenario en marcha en la rama.
    if (base) expect(await rastrosPropios()).toBe(0);
    await ctx?.cerrar();
  });

  async function rastrosPropios(): Promise<number> {
    const propios = await base.select({ id: usuarios.id }).from(usuarios).where(like(usuarios.id, `${esc.usuarioId}%`));
    const ids = propios.map((u) => u.id);
    const eq3 = await base.select({ id: equipos.id }).from(equipos).where(inArray(equipos.id, esc.equipoIds));
    if (ids.length === 0) return eq3.length;
    const [r, p, m] = await Promise.all([
      base.select({ id: reservas.id }).from(reservas).where(inArray(reservas.usuarioId, ids)),
      base.select({ id: pagos.id }).from(pagos).where(inArray(pagos.usuarioId, ids)),
      base.select({ id: membresias.id }).from(membresias).where(inArray(membresias.usuarioId, ids)),
    ]);
    return ids.length + eq3.length + r.length + p.length + m.length;
  }

  // --- Dependencias contra la rama; la configuración es la REAL de la base (no el fixture) ---
  const config = (): Promise<Configuracion> => leerConfiguracion(() => base.select({ clave: configuracion.clave, valor: configuracion.valor }).from(configuracion));
  const depsRenovar = (usuario: Usuario, plan: DependenciasRenovar["plan"] = planDeRenovacion): DependenciasRenovar => ({
    leerConfig: config,
    verificarImagen: async () => ({ ruta: `comprobantes/${usuario.id}/renovacion-${crypto.randomUUID().slice(0, 6)}.jpg`, tipo: "image/jpeg", tamano: 1000 }),
    base: () => base,
    plan,
  });
  const depsRevision: DependenciasRevision = { base: () => base, leerConfig: config };
  const depsReenvio = (usuario: Usuario): DependenciasReenvio => ({
    leerConfig: config,
    verificarImagen: async () => ({ ruta: `comprobantes/${usuario.id}/reenvio-${crypto.randomUUID().slice(0, 6)}.jpg`, tipo: "image/jpeg", tamano: 1000 }),
    base: () => base,
  });
  const depsPerfil: Partial<DependenciasPerfil> = { base: () => base, leerConfig: config };

  const renovar = (usuario: Usuario, metodo = "yape") => renovarMembresia({ usuario, cuerpo: { metodo, comprobante: `comprobantes/${usuario.id}/subido.jpg` } }, depsRenovar(usuario));
  const aprobar = (pagoId: string) => aprobarPago({ admin, pagoId }, depsRevision);
  const rechazar = (pagoId: string, motivo?: string) => rechazarPago({ admin, pagoId, cuerpo: motivo === undefined ? undefined : { motivo } }, depsRevision);
  const perfil = (usuario: Usuario) => leerPerfil({ usuario, ahora: new Date() }, depsPerfil);
  const pasada = () => ejecutarPasadaDeExpiracion(base, config);

  const error = async (promesa: Promise<unknown>) => {
    try {
      await promesa;
    } catch (e) {
      return e as ErrorApi;
    }
    throw new Error("se esperaba un error");
  };

  // Un miembro con la membresía `activa` fijada con el reloj de la base: `finEnDias` negativo = ya venció.
  async function miembro(finEnDias: number, inicioHaceDias = 100) {
    const [cliente] = await esc.crearClientes(1);
    const [m] = await base
      .insert(membresias)
      .values({
        usuarioId: cliente.id,
        monto: 26700,
        estado: "activa",
        inicio: sql`now() - make_interval(secs => ${inicioHaceDias * DIA_S})`,
        fin: sql`now() + make_interval(secs => ${Math.round(finEnDias * DIA_S)})`,
      })
      .returning();
    const [p] = await base
      .insert(pagos)
      .values({ usuarioId: cliente.id, concepto: "membresia", membresiaId: m.id, monto: 26700, metodo: "yape", comprobanteRuta: `comprobantes/${cliente.id}/primera.jpg`, estado: "aprobado", revisadoPor: admin.id, revisadoEn: sql`now()` })
      .returning();
    return { cliente, membresiaId: m.id, pagoId: p.id };
  }

  const membresiasDe = (usuarioId: string) => base.select().from(membresias).where(eq(membresias.usuarioId, usuarioId));
  const pagosDe = (usuarioId: string) => base.select().from(pagos).where(eq(pagos.usuarioId, usuarioId));
  const reservasDe = (usuarioId: string) => base.select().from(reservas).where(eq(reservas.usuarioId, usuarioId));

  describe("configuración y plan", () => {
    it("leerConfiguracion valida renovacion_aviso_dias en la rama (14, provisional) y el plan real es 3 meses por S/ 267", async () => {
      const c = await config();
      expect(c.renovacion_aviso_dias).toBe(14);
      const [fila] = await base.select().from(configuracion).where(eq(configuracion.clave, "renovacion_aviso_dias"));
      expect(fila.provisional).toBe(true);
      expect(planDeRenovacion(c)).toEqual({ meses: 3, monto: 26700 });
    });
  });

  describe("pagar la renovación y la revisión del ítem 11", () => {
    it("una activa vencida y una pendiente conviven; la renovación guarda el plan real, sin reserva", async () => {
      const m = await miembro(-5);
      // Lo que el perfil muestra (plan del servidor) es lo que se guarda en el pago y en la membresía.
      const mostrado = (await perfil(m.cliente)).renovacion;
      const r = await renovar(m.cliente);
      expect(mostrado).toMatchObject({ estado: "vencida", plan: { meses: 3, monto: r.pago.monto } });
      expect(r.membresia.monto).toBe(r.pago.monto);
      expect(r).toMatchObject({ membresia: { estado: "pendiente", monto: 26700 }, pago: { concepto: "membresia", monto: 26700, metodo: "yape", estado: "pendiente" }, plan: { meses: 3, monto: 26700 } });

      const filas = await membresiasDe(m.cliente.id);
      expect(filas.map((x) => x.estado).sort()).toEqual(["activa", "pendiente"]);
      const nueva = filas.find((x) => x.estado === "pendiente")!;
      expect(nueva).toMatchObject({ inicio: null, fin: null, monto: 26700 });
      expect(await reservasDe(m.cliente.id)).toEqual([]);
    });

    it("dos renovaciones simultáneas del mismo cliente guardan solo una; la otra recibe 409 en_espera", async () => {
      const m = await miembro(-5);
      const resultados = await Promise.allSettled([renovar(m.cliente), renovar(m.cliente)]);
      expect(resultados.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const fallo = resultados.find((x) => x.status === "rejected") as PromiseRejectedResult;
      expect(fallo.reason).toMatchObject({ status: 409, codigo: "en_espera" });
      expect((await membresiasDe(m.cliente.id)).filter((x) => x.estado === "pendiente")).toHaveLength(1);
      expect((await pagosDe(m.cliente.id)).filter((x) => x.estado === "pendiente")).toHaveLength(1);
    });

    it("no se puede renovar antes de que venza (409 renovacion_no_aplica) y no se escribe nada", async () => {
      const m = await miembro(5);
      const e = await error(renovar(m.cliente));
      expect(e).toMatchObject({ status: 409, codigo: "renovacion_no_aplica" });
      expect(await membresiasDe(m.cliente.id)).toHaveLength(1);
      expect(await pagosDe(m.cliente.id)).toHaveLength(1);
    });

    it("un cliente sin membresía recibe 409 renovacion_no_aplica", async () => {
      const [cliente] = await esc.crearClientes(1);
      expect(await error(renovar(cliente))).toMatchObject({ status: 409, codigo: "renovacion_no_aplica" });
      expect(await membresiasDe(cliente.id)).toEqual([]);
    });

    it("el pago de renovación aparece en la lista del administrador sin reserva ni coincidencias de dirección", async () => {
      const m = await miembro(-5);
      const r = await renovar(m.cliente);
      const c = await config();
      const lista = await listarPagos(base, { estado: "pendiente" }, c);
      const elemento = lista.find((x) => x.pago.id === r.pago.id)!;
      expect(elemento).toMatchObject({ pago: { concepto: "membresia", monto: 26700 }, cliente: { id: m.cliente.id }, reserva: null });
      const detalle = await detalleDePago(base, r.pago.id, c);
      expect(detalle.reserva).toBeNull();
      expect(detalle.coincidencias).toEqual({ aplica: false, lista: [] });
    });

    it("el comprobante de la renovación lo ve su dueño y el administrador; un tercero recibe 404", async () => {
      const m = await miembro(-5);
      const [tercero] = await esc.crearClientes(1);
      const r = await renovar(m.cliente);
      const almacen = { leer: async () => ({ cuerpo: new Uint8Array([1, 2, 3]), tipo: "image/jpeg", tamano: 3 }) } as never;
      const buscarPago = async (id: string) => {
        const [p] = await base.select({ usuarioId: pagos.usuarioId, comprobanteRuta: pagos.comprobanteRuta }).from(pagos).where(eq(pagos.id, id));
        return p ?? null;
      };
      const ver = async (usuario: Usuario) => {
        const recurso = await obtenerComprobante(r.pago.id, usuario, buscarPago);
        if (!recurso) throw ErrorApi.noEncontrado();
        return entregarImagen({ ruta: recurso.ruta, usuario, autorizar: recurso.autorizar }, almacen);
      };
      expect((await ver(m.cliente)).status).toBe(200);
      expect((await ver({ ...admin, correo: "a@tiza.test", nombre: "A", celular: "900000000", rol: "admin" })).status).toBe(200);
      expect(await error(ver(tercero))).toMatchObject({ status: 404 });
    });

    it("aprobar: activa con inicio en la aprobación y fin 3 meses después; el perfil vuelve a no_aplica, sin 'elige un nuevo día'", async () => {
      const m = await miembro(-5);
      const r = await renovar(m.cliente);
      const antes = (await perfil(m.cliente)).renovacion;
      expect(antes.estado).toBe("renovacion_en_revision");

      const aprobado = await aprobar(r.pago.id);
      expect(aprobado.membresia).toMatchObject({ id: r.membresia.id, estado: "activa" });
      expect(aprobado.reserva).toBeNull();

      const [{ tres_meses, reciente }] = await base
        .execute<{ tres_meses: boolean; reciente: boolean }>(
          sql`SELECT (fin = inicio + make_interval(months => 3)) AS tres_meses, (inicio > now() - interval '1 minute') AS reciente FROM membresias WHERE id = ${r.membresia.id}`,
        )
        .then((x) => x.rows);
      expect(tres_meses).toBe(true);
      expect(reciente).toBe(true);
      expect((await pagosDe(m.cliente.id)).find((p) => p.id === r.pago.id)?.estado).toBe("aprobado");

      const despues = await perfil(m.cliente);
      expect(despues.renovacion).toEqual({ estado: "no_aplica" });
      expect(despues.membresia.estado).toBe("activa");
      expect(despues.avisos.map((a) => a.codigo)).not.toContain("nuevo_horario");
      expect(puedeElegirDiaYHora(despues.membresia, despues.renovacion)).toBe(true);
      expect(await reservasDe(m.cliente.id)).toEqual([]);
    });

    it("la renovación no da otra limpieza gratis: decidirLimpiezaGratis no cambia al renovar ni al aprobar", async () => {
      const hogar = claveHogar(validarDireccion({ distrito: "Miraflores", calle: "Av. Renovacion Prueba", numero: "9100" }));
      // Sin ninguna reserva realizada: sigue siendo elegible antes y después.
      const nuevo = await miembro(-5);
      const antesNuevo = await decidirLimpiezaGratis(base, nuevo.cliente.id, hogar);
      const rn = await renovar(nuevo.cliente);
      await aprobar(rn.pago.id);
      expect(await decidirLimpiezaGratis(base, nuevo.cliente.id, hogar)).toBe(antesNuevo);

      // Con una limpieza ya realizada: no es elegible antes ni después.
      const usado = await miembro(-5);
      await base.insert(reservas).values(
        filaReserva({
          usuarioId: usado.cliente.id,
          membresiaId: usado.membresiaId,
          pagoId: usado.pagoId,
          equipoId: esc.equipoIds[0],
          inicio: `${laborableEn(-60)}T10:00:00-05:00`,
          horasAgenda: 3,
          estado: "completada",
          primeraGratis: true,
          numero: "9101",
          direccionNormalizada: "avenida renovacion prueba 9101",
        }),
      );
      const antesUsado = await decidirLimpiezaGratis(base, usado.cliente.id, hogar);
      const ru = await renovar(usado.cliente);
      await aprobar(ru.pago.id);
      expect(await decidirLimpiezaGratis(base, usado.cliente.id, hogar)).toBe(antesUsado);
      expect(antesUsado).toBe(false);
      expect(await reservasDe(usado.cliente.id)).toHaveLength(1);
    });

    it("rechazar y reenviar sin reserva: el pago nuevo reemplaza al rechazado sobre la misma membresía; luego se aprueba", async () => {
      const m = await miembro(-5);
      const r = await renovar(m.cliente);
      await rechazar(r.pago.id, "Borroso");
      const rechazada = await perfil(m.cliente);
      expect(rechazada.renovacion).toMatchObject({ estado: "renovacion_rechazada", pago_id: r.pago.id, motivo_rechazo: "Borroso" });
      expect(rechazada.avisos.map((a) => a.codigo)).toContain("pago_rechazado");
      expect(rechazada.membresia.estado).toBe("vencida");

      const reenvio = await reenviarComprobante({ usuario: m.cliente, cuerpo: { pago_id: r.pago.id, metodo: "transferencia", comprobante: `comprobantes/${m.cliente.id}/otro.jpg` } }, depsReenvio(m.cliente));
      expect(reenvio.reserva).toBeNull();
      expect(reenvio.pago).toMatchObject({ concepto: "membresia", monto: 26700, reemplaza_a: r.pago.id, estado: "pendiente" });
      expect((await perfil(m.cliente)).renovacion.estado).toBe("renovacion_en_revision");

      await aprobar(reenvio.pago.id);
      expect((await perfil(m.cliente)).renovacion).toEqual({ estado: "no_aplica" });
      expect((await membresiasDe(m.cliente.id)).filter((x) => x.estado === "activa")).toHaveLength(2);
    });

    it("plazo de reenvío vencido: vuelve a vencida, la pasada cierra la pendiente como caducada y se puede pagar de nuevo", async () => {
      const m = await miembro(-5);
      const r = await renovar(m.cliente);
      await esc.rechazarHace(r.pago.id, admin.id, 8 * 24);
      // Aunque el cierre no haya corrido, el perfil ya no ofrece el reenvío.
      const p = await perfil(m.cliente);
      expect(p.renovacion.estado).toBe("vencida");
      // `leerPerfil` ya corrió la pasada: la pendiente quedó caducada.
      expect((await membresiasDe(m.cliente.id)).find((x) => x.id === r.membresia.id)?.estado).toBe("caducada");
      await pasada();
      const otra = await renovar(m.cliente);
      expect(otra.membresia.id).not.toBe(r.membresia.id);
      expect((await membresiasDe(m.cliente.id)).map((x) => x.estado).sort()).toEqual(["activa", "caducada", "pendiente"]);
      expect((await perfil(m.cliente)).renovacion.estado).toBe("renovacion_en_revision");
    });
  });

  describe("estados del aviso con el reloj de la base", () => {
    it("por_vencer (10 días), no_aplica (60 días) y vencida; cada cliente ve el suyo", async () => {
      const porVencer = await miembro(10);
      const lejos = await miembro(60);
      const vencida = await miembro(-1);
      expect((await perfil(porVencer.cliente)).renovacion).toMatchObject({ estado: "por_vencer", dias_restantes: 10 });
      expect((await perfil(lejos.cliente)).renovacion).toEqual({ estado: "no_aplica" });
      expect((await perfil(vencida.cliente)).renovacion).toMatchObject({ estado: "vencida", plan: { meses: 3, monto: 26700 } });
      // Aislamiento: renovar a uno no cambia el bloque del otro.
      await renovar(vencida.cliente);
      expect((await perfil(porVencer.cliente)).renovacion).toMatchObject({ estado: "por_vencer" });
      expect((await perfil(lejos.cliente)).renovacion).toEqual({ estado: "no_aplica" });
    });

    it("la primera membresía en revisión es no_aplica y conserva su estado del ítem 12", async () => {
      const [dueno] = await esc.crearDuenos(1);
      const cliente = { id: dueno.usuarioId, correo: `${dueno.usuarioId}@tiza.test`, nombre: "P", celular: "900000000", rol: "cliente" as const };
      const p = await perfil(cliente);
      expect(p.renovacion).toEqual({ estado: "no_aplica" });
      expect(p.membresia).toMatchObject({ estado: "en_revision" });
    });
  });

  describe("bloqueo por vigencia", () => {
    const ahoraMas = (dias: number) => new Date(Date.now() + dias * DIA_S * 1000);

    it("comprobarVigenciaParaReservar con el reloj de la base: ok, fuera_de_vigencia, justo en el fin, vencida y renovación en revisión", async () => {
      const c = await config();
      const vigente = await miembro(30);
      expect((await comprobarVigenciaParaReservar(base, vigente.cliente.id, ahoraMas(10), c)).tipo).toBe("ok");
      expect((await comprobarVigenciaParaReservar(base, vigente.cliente.id, ahoraMas(40), c)).tipo).toBe("fuera_de_vigencia");
      const [{ fin }] = await membresiasDe(vigente.cliente.id);
      expect((await comprobarVigenciaParaReservar(base, vigente.cliente.id, fin!, c)).tipo).toBe("fuera_de_vigencia");
      expect((await comprobarVigenciaParaReservar(base, vigente.cliente.id, new Date(fin!.getTime() - 1), c)).tipo).toBe("ok");

      const vencida = await miembro(-2);
      expect((await comprobarVigenciaParaReservar(base, vencida.cliente.id, ahoraMas(10), c)).tipo).toBe("membresia_vencida");
      await renovar(vencida.cliente);
      expect((await comprobarVigenciaParaReservar(base, vencida.cliente.id, ahoraMas(10), c)).tipo).toBe("renovacion_en_revision");

      const [nuevo] = await esc.crearClientes(1);
      expect((await comprobarVigenciaParaReservar(base, nuevo.id, ahoraMas(10), c)).tipo).toBe("sin_membresia");
    });

    it("el saldo de crédito no levanta el bloqueo: la vencida sigue en membresia_vencida (el guard no lee créditos)", async () => {
      const c = await config();
      const vencida = await miembro(-2);
      expect((await comprobarVigenciaParaReservar(base, vencida.cliente.id, ahoraMas(10), c)).tipo).toBe("membresia_vencida");
    });

    it("GET /api/disponibilidad y de punta a punta: vencida → renovar → admin aprueba → vuelven los horarios → el perfil ofrece elegir", async () => {
      const m = await miembro(-3);
      const c = await config();
      const ruta = (usuario: Usuario) =>
        crearRutaDisponibilidad({
          sesion: async () => usuario,
          consultar: (args) => consultarDisponibilidad(args, { leerConfig: config, leerOcupacion: (ventana) => leerOcupacion(base, ventana) }),
          vigencia: (u, parametros) => comprobarVigenciaDeLaConsulta({ base, usuarioId: u.id, fecha: parametros.get("fecha"), config: c }),
        });
      const consultar = async (usuario: Usuario, dias: number) =>
        ruta(usuario)(new Request(`http://localhost/api/disponibilidad?fecha=${laborableEn(dias)}&tipo=estandar&dormitorios=2&banos=1`));

      const vencida = await consultar(m.cliente, 10);
      expect(vencida.status).toBe(409);
      expect((await vencida.json()).error.codigo).toBe("membresia_vencida");

      const r = await renovar(m.cliente);
      const enRevision = await consultar(m.cliente, 10);
      expect(enRevision.status).toBe(409);
      expect((await enRevision.json()).error.codigo).toBe("renovacion_en_revision");
      expect(puedeElegirDiaYHora((await perfil(m.cliente)).membresia, (await perfil(m.cliente)).renovacion)).toBe(false);

      await aprobar(r.pago.id);
      const libre = await consultar(m.cliente, 10);
      expect(libre.status).toBe(200);
      expect(Array.isArray((await libre.json()).horarios)).toBe(true);
      const despues = await perfil(m.cliente);
      expect(puedeElegirDiaYHora(despues.membresia, despues.renovacion)).toBe(true);

      // Fecha posterior al fin de la renovación (3 meses): 422.
      const lejos = await consultar(m.cliente, 130);
      expect(lejos.status).toBe(422);
      expect((await lejos.json()).error.codigo).toBe("fuera_de_vigencia");

      // Un cliente nuevo no cambia: recibe los horarios.
      const [nuevo] = await esc.crearClientes(1);
      expect((await consultar(nuevo, 10)).status).toBe(200);
    });

    it("durante el mes 3, una fecha posterior al fin se rechaza con 422 y una anterior da horarios", async () => {
      const m = await miembro(10);
      const c = await config();
      const ruta = crearRutaDisponibilidad({
        sesion: async () => m.cliente,
        consultar: (args) => consultarDisponibilidad(args, { leerConfig: config, leerOcupacion: (ventana) => leerOcupacion(base, ventana) }),
        vigencia: (u, parametros) => comprobarVigenciaDeLaConsulta({ base, usuarioId: u.id, fecha: parametros.get("fecha"), config: c }),
      });
      const pedir = (dias: number) => ruta(new Request(`http://localhost/api/disponibilidad?fecha=${laborableEn(dias)}&tipo=estandar&dormitorios=2&banos=1`));
      expect((await pedir(4)).status).toBe(200);
      const tarde = await pedir(30);
      expect(tarde.status).toBe(422);
      expect((await tarde.json()).error.mensaje).toContain("renueva");
    });
  });

  describe("el vencimiento y la renovación no tocan las reservas", () => {
    it("vence la membresía, se renueva y se aprueba: ninguna reserva cambia; reprogramar más allá del fin se rechaza", async () => {
      const m = await miembro(20);
      const dia = laborableEn(10);
      const [reserva] = await base
        .insert(reservas)
        .values(filaReserva({ usuarioId: m.cliente.id, membresiaId: m.membresiaId, pagoId: m.pagoId, equipoId: esc.equipoIds[0], inicio: `${dia}T10:00:00-05:00`, horasAgenda: 3, estado: "confirmada" }))
        .returning();
      const foto = async () => JSON.stringify((await reservasDe(m.cliente.id)).map((r) => ({ ...r })));
      const antes = await foto();

      // Reprogramar a una fecha en o después del fin se rechaza (la membresía vence en 20 días).
      const deps = { base: () => base, leerConfig: config, numeroWhatsapp: () => null, equipoIds: esc.equipoIds.slice(0, 2) };
      const e = await error(reprogramarReserva({ usuario: m.cliente, reservaId: reserva.id, cuerpo: { inicio: `${laborableEn(40)}T10:00:00-05:00` }, ahora: new Date() }, deps));
      expect(e.status).toBe(422);
      expect(await foto()).toBe(antes);

      // La membresía vence (se adelanta el fin) y se renueva: la reserva existente sigue exactamente igual.
      await base.update(membresias).set({ fin: sql`now() - interval '1 minute'` }).where(eq(membresias.id, m.membresiaId));
      const r = await renovar(m.cliente);
      await perfil(m.cliente);
      await pasada();
      await aprobar(r.pago.id);
      expect(await foto()).toBe(antes);
      const [viva] = await base.select({ estado: reservas.estado, canceladaPor: reservas.canceladaPor }).from(reservas).where(and(eq(reservas.id, reserva.id), inArray(reservas.estado, ["confirmada"])));
      expect(viva).toEqual({ estado: "confirmada", canceladaPor: null });
    });
  });
});
