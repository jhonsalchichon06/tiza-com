import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "@/lib/__fixtures__/configuracion";
import { transaccionDeEscritura } from "@/lib/agenda/expirar";
import { validarParametro } from "@/lib/configuracion";
import { buscarFoto, obtenerFoto } from "@/lib/fotos/entrega";
import { registrarFotos, type DependenciasRegistrar } from "@/lib/fotos/registrar";
import type { ErrorApi } from "@/lib/errores";
import type { AlmacenDeImagenes, ElementoListado } from "@/lib/imagenes/almacen";
import { limpiarHuerfanos } from "@/lib/imagenes/huerfanos";
import { COLUMNAS_CON_IMAGEN, leerRutasReferenciadas } from "@/lib/imagenes/referencias";
import { verificarImagenSubida } from "@/lib/imagenes/verificar";
import { leerDetalleReserva } from "@/lib/perfil/detalle";
import { listarHistorial } from "@/lib/perfil/reservas";
import type { Usuario } from "@/lib/sesion";
import { configuracion, fotosServicio, reservas, usuarios } from "./esquema";
import { PRUEBAS_BD_ACTIVAS, crearBasePruebas, crearEscenario, filaReserva, type BasePruebas, type Dueno } from "./pruebas-bd";

// Fotos del servicio contra la rama `pruebas` de Neon (change fotos-del-servicio): registro atómico con límite y bloqueo,
// aislamiento entre clientes, y que el cron de huérfanos respete las fotos en uso. Blob es un almacén SIMULADO (sin red).
// Corre con PRUEBAS_BD=1. Prefijos propios (otras suites usan la misma rama a la vez); fechas de 2099; correos @tiza.test.
const CLAVE_LIMITE = "fotos_maximas_por_reserva";
const PREFIJOS = { usuario: "prueba-fotos-", equipo: "PRUEBA-fotos-" };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0]);

describe.skipIf(!PRUEBAS_BD_ACTIVAS)("fotos del servicio (Neon)", () => {
  let ctx: ReturnType<typeof crearBasePruebas>;
  let base: BasePruebas;
  let esc: Awaited<ReturnType<typeof crearEscenario>>;
  let admin: { id: string };
  let usuarioAdmin: { id: string; rol: "admin" };
  let limiteOriginal: unknown;
  const archivos = new Map<string, Uint8Array>();

  // Almacén de Blob simulado: solo lo que la prueba "subió".
  const almacen: Pick<AlmacenDeImagenes, "metadatos" | "leerInicio"> = {
    metadatos: async (ruta) => (archivos.has(ruta) ? { tamano: archivos.get(ruta)!.length, tipoDeclarado: "image/jpeg" } : null),
    leerInicio: async (ruta, bytes) => archivos.get(ruta)?.slice(0, bytes) ?? null,
  };
  let contadorRutas = 0;
  const subir = (reservaId: string, bytes = JPEG, extension = "jpg") => {
    const ruta = `fotos/${reservaId}/prueba-${Date.now()}-${++contadorRutas}.${extension}`;
    archivos.set(ruta, bytes);
    return ruta;
  };

  async function leerLimite(): Promise<number> {
    const [fila] = await base.select({ valor: configuracion.valor }).from(configuracion).where(eq(configuracion.clave, CLAVE_LIMITE));
    return validarParametro(CLAVE_LIMITE, fila.valor);
  }
  const dependencias = (): DependenciasRegistrar => ({
    base: () => base,
    transaccion: transaccionDeEscritura,
    baseDeEscritura: () => base,
    verificar: (entrada) => verificarImagenSubida(entrada, almacen),
    leerLimite,
  });
  const registrar = (reservaId: string, fotos: { ruta: string; ambiente: string }[]) =>
    registrarFotos({ usuario: usuarioAdmin, reservaId, cuerpo: { fotos } }, dependencias());
  const fallo = async (p: Promise<unknown>) => (await p.then(() => null, (e) => e)) as ErrorApi | null;

  let dia = 0;
  const nuevoInicio = () => new Date(Date.UTC(2099, 5, 1 + dia++, 15)).toISOString();
  type Reserva = typeof reservas.$inferSelect;
  async function poner(estado: Reserva["estado"], dueno?: Dueno) {
    const d = dueno ?? (await esc.crearDueno());
    const [fila] = await base
      .insert(reservas)
      .values({ ...filaReserva({ ...d, equipoId: esc.equipoIds[0], inicio: nuevoInicio(), horasAgenda: 2, estado }) })
      .returning({ id: reservas.id });
    return { id: fila.id, dueno: d };
  }
  const filasDe = (reservaId: string) => base.select().from(fotosServicio).where(eq(fotosServicio.reservaId, reservaId));
  const insertarDirecto = (reservaId: string, ambiente = "cocina") =>
    base.insert(fotosServicio).values({ reservaId, ambiente, ruta: subir(reservaId), subidaPor: admin.id }).returning({ id: fotosServicio.id, ruta: fotosServicio.ruta });

  const cliente = (id: string): Usuario => ({ id, correo: `${id}@tiza.test`, nombre: "Prueba fotos", celular: "900000000", rol: "cliente" });

  beforeAll(async () => {
    ctx = crearBasePruebas();
    base = ctx.base;
    esc = await crearEscenario(base, PREFIJOS);
    admin = await esc.crearAdmin();
    usuarioAdmin = { id: admin.id, rol: "admin" };
    limiteOriginal = (await base.select({ valor: configuracion.valor }).from(configuracion).where(eq(configuracion.clave, CLAVE_LIMITE)))[0]?.valor;
  });

  afterAll(async () => {
    // Si una prueba cambió el límite y falló a medias, se restaura el valor original.
    if (base && limiteOriginal !== undefined) await base.update(configuracion).set({ valor: limiteOriginal }).where(eq(configuracion.clave, CLAVE_LIMITE));
    await esc?.limpiar();
    // Rastros PROPIOS de esta corrida (el conteo global incluye a las suites de otros que corren a la vez): deben ser 0.
    if (base) {
      const mios = await base.select({ id: usuarios.id }).from(usuarios).where(like(usuarios.id, `${PREFIJOS.usuario}%`));
      expect(mios.length).toBe(0);
      const reservasMias = await base.select({ id: reservas.id }).from(reservas).where(inArray(reservas.usuarioId, mios.map((m) => m.id)));
      expect(reservasMias.length).toBe(0);
      const fotosMias = await base.select({ id: fotosServicio.id }).from(fotosServicio).where(like(fotosServicio.ruta, "fotos/%/prueba-%"));
      expect(fotosMias.length).toBe(0);
    }
    await ctx?.cerrar();
  });

  it("el límite inicial en la rama es 12 y provisional", async () => {
    const [fila] = await base.select().from(configuracion).where(eq(configuracion.clave, CLAVE_LIMITE));
    expect(fila.valor).toBe(12);
    expect(fila.provisional).toBe(true);
    expect(VALORES_DEL_DISENO.fotos_maximas_por_reserva).toBe(12);
  });

  describe("registro", () => {
    it("fotos en una reserva completada: se registran con subida_por del administrador", async () => {
      const { id } = await poner("completada");
      const r = await registrar(id, [
        { ruta: subir(id), ambiente: "cocina" },
        { ruta: subir(id), ambiente: "bano" },
        { ruta: subir(id, JPEG, "webp"), ambiente: "sala" },
      ]);
      expect(r).toHaveLength(3);
      const filas = await filasDe(id);
      expect(filas).toHaveLength(3);
      expect(filas.every((f) => f.subidaPor === admin.id)).toBe(true);
      expect(filas.map((f) => f.ambiente).sort()).toEqual(["bano", "cocina", "sala"]);
    });

    it.each(["confirmada", "pendiente", "cancelada"] as const)("reserva %s: 409 y ninguna fila", async (estado) => {
      const { id } = await poner(estado);
      const e = await fallo(registrar(id, [{ ruta: subir(id), ambiente: "cocina" }]));
      expect(e?.status).toBe(409);
      expect(await filasDe(id)).toHaveLength(0);
    });

    it("reserva inexistente: 404", async () => {
      const e = await fallo(registrar(crypto.randomUUID(), [{ ruta: "fotos/x/1.jpg", ambiente: "cocina" }]));
      expect(e?.status).toBe(404);
    });

    it("una ruta que ya tiene una foto: 409 por la clave única (con el error real del controlador) y sigue habiendo una fila", async () => {
      const { id } = await poner("completada");
      const ruta = subir(id);
      await registrar(id, [{ ruta, ambiente: "cocina" }]);
      const e = await fallo(registrar(id, [{ ruta, ambiente: "sala" }]));
      expect(e?.status).toBe(409);
      expect(e?.message).toBe("Esas fotos ya estaban registradas.");
      expect(await filasDe(id)).toHaveLength(1);
    });

    it("la base rechaza una segunda fila con la misma ruta (restricción de unicidad)", async () => {
      const { id } = await poner("completada");
      const [primera] = await insertarDirecto(id);
      const rechazo = await base.insert(fotosServicio).values({ reservaId: id, ambiente: "sala", ruta: primera.ruta, subidaPor: admin.id }).then(() => null, (e) => e);
      expect((rechazo?.cause ?? rechazo)?.code).toBe("23505");
    });

    it("un archivo inexistente, un PDF con extensión .png y una foto de otra reserva: error y ninguna fila, aunque las otras sean válidas", async () => {
      const { id } = await poner("completada");
      const { id: otra } = await poner("completada");
      const buena = subir(id);
      expect((await fallo(registrar(id, [{ ruta: buena, ambiente: "cocina" }, { ruta: `fotos/${id}/no-existe.jpg`, ambiente: "sala" }])))?.status).toBe(404);
      expect((await fallo(registrar(id, [{ ruta: buena, ambiente: "cocina" }, { ruta: subir(id, PDF, "png"), ambiente: "sala" }])))?.status).toBe(422);
      expect((await fallo(registrar(id, [{ ruta: buena, ambiente: "cocina" }, { ruta: subir(otra), ambiente: "sala" }])))?.status).toBe(422);
      expect(await filasDe(id)).toHaveLength(0);
      expect(await filasDe(otra)).toHaveLength(0);
    });

    it("el límite: 11 existentes + 2 nuevas da 409 sin insertar; 10 + 2 llega a 12", async () => {
      const { id } = await poner("completada");
      for (let i = 0; i < 10; i++) await insertarDirecto(id);
      const ok = await registrar(id, [{ ruta: subir(id), ambiente: "cocina" }, { ruta: subir(id), ambiente: "sala" }]);
      expect(ok).toHaveLength(2);
      expect(await filasDe(id)).toHaveLength(12);

      const { id: otra } = await poner("completada");
      for (let i = 0; i < 11; i++) await insertarDirecto(otra);
      const e = await fallo(registrar(otra, [{ ruta: subir(otra), ambiente: "cocina" }, { ruta: subir(otra), ambiente: "sala" }]));
      expect(e?.status).toBe(409);
      expect(e?.message).toMatch(/solo caben 1 más/);
      expect(await filasDe(otra)).toHaveLength(11);
    });

    it("un envío de 13 con límite 12 no registra ninguna", async () => {
      const { id } = await poner("completada");
      const trece = Array.from({ length: 13 }, () => ({ ruta: subir(id), ambiente: "otro" }));
      const e = await fallo(registrar(id, trece));
      expect(e?.status).toBe(422);
      expect(await filasDe(id)).toHaveLength(0);
    });

    it("dos envíos simultáneos de 7 fotos a una reserva sin fotos: uno 201, otro 409, y quedan 7", async () => {
      const { id } = await poner("completada");
      const lote = () => Array.from({ length: 7 }, () => ({ ruta: subir(id), ambiente: "cocina" }));
      const resultados = await Promise.allSettled([registrar(id, lote()), registrar(id, lote())]);
      const buenos = resultados.filter((r) => r.status === "fulfilled");
      const malos = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(buenos).toHaveLength(1);
      expect(malos).toHaveLength(1);
      expect((malos[0].reason as ErrorApi).status).toBe(409);
      expect(await filasDe(id)).toHaveLength(7);
    });

    it("cambiar fotos_maximas_por_reserva en la rama cambia el resultado (se restaura al terminar)", async () => {
      const { id } = await poner("completada");
      try {
        await base.update(configuracion).set({ valor: 5 }).where(eq(configuracion.clave, CLAVE_LIMITE));
        const seis = Array.from({ length: 6 }, () => ({ ruta: subir(id), ambiente: "cocina" }));
        expect((await fallo(registrar(id, seis)))?.status).toBe(422);
        const cinco = Array.from({ length: 5 }, () => ({ ruta: subir(id), ambiente: "cocina" }));
        expect(await registrar(id, cinco)).toHaveLength(5);
        const otra = await fallo(registrar(id, [{ ruta: subir(id), ambiente: "sala" }]));
        expect(otra?.status).toBe(409);
        expect(otra?.message).toMatch(/máximo de 5/);
      } finally {
        await base.update(configuracion).set({ valor: limiteOriginal }).where(eq(configuracion.clave, CLAVE_LIMITE));
      }
      expect(await leerLimite()).toBe(12);
    });

    it("una fila con reserva_id inexistente la rechaza la clave foránea", async () => {
      const rechazo = await base.insert(fotosServicio).values({ reservaId: crypto.randomUUID(), ambiente: "cocina", ruta: `fotos/zz/prueba-${Date.now()}.jpg`, subidaPor: admin.id }).then(() => null, (e) => e);
      expect((rechazo?.cause ?? rechazo)?.code).toBe("23503");
    });

    it("una fila con subida_por inexistente la rechaza la clave foránea", async () => {
      const { id } = await poner("completada");
      const rechazo = await base.insert(fotosServicio).values({ reservaId: id, ambiente: "cocina", ruta: `fotos/${id}/prueba-sin-usuario.jpg`, subidaPor: "no-existe" }).then(() => null, (e) => e);
      expect((rechazo?.cause ?? rechazo)?.code).toBe("23503");
    });
  });

  describe("aislamiento entre clientes", () => {
    it("obtenerFoto: el dueño recibe la ruta; otro cliente da null; el administrador ve ambas; el detalle y el historial no mezclan clientes", async () => {
      const A = await poner("completada");
      const B = await poner("completada");
      const [fa] = await insertarDirecto(A.id, "cocina");
      await insertarDirecto(A.id, "bano");
      const [fb] = await insertarDirecto(B.id, "sala");
      const idFoto = async (ruta: string) => (await base.select({ id: fotosServicio.id }).from(fotosServicio).where(eq(fotosServicio.ruta, ruta)))[0].id;
      const idA = await idFoto(fa.ruta);
      const idB = await idFoto(fb.ruta);
      const buscar = (id: string) => buscarFoto(base, id);

      // A sobre su foto: recurso con permiso. A sobre la de B: el recurso existe pero NO autoriza a A (→ 404 sin leer Blob).
      const propia = await obtenerFoto(idA, cliente(A.dueno.usuarioId), buscar);
      expect(propia?.ruta).toBe(fa.ruta);
      expect(await propia?.autorizar(cliente(A.dueno.usuarioId), fa.ruta)).toBe(true);
      const ajena = await obtenerFoto(idB, cliente(A.dueno.usuarioId), buscar);
      expect(await ajena?.autorizar(cliente(A.dueno.usuarioId), fb.ruta)).toBe(false);
      // El administrador ve ambas.
      const comoAdmin = { ...cliente(admin.id), rol: "admin" as const };
      expect(await (await obtenerFoto(idA, comoAdmin, buscar))?.autorizar(comoAdmin, fa.ruta)).toBe(true);
      expect(await (await obtenerFoto(idB, comoAdmin, buscar))?.autorizar(comoAdmin, fb.ruta)).toBe(true);
      // Un id inexistente y uno mal formado dan null.
      expect(await obtenerFoto(crypto.randomUUID(), cliente(A.dueno.usuarioId), buscar)).toBeNull();
      expect(await obtenerFoto("abc", cliente(A.dueno.usuarioId), buscar)).toBeNull();

      // Detalle de A: solo sus 2 fotos; la reserva de B pedida por A da 404 sin fotos.
      const deps = { base: () => base, leerConfig: async () => VALORES_DEL_DISENO };
      const ahora = new Date("2099-01-01T00:00:00Z");
      const detalle = await leerDetalleReserva({ usuario: { id: A.dueno.usuarioId }, reservaId: A.id, ahora }, deps);
      expect(detalle.fotos.map((f) => f.ambiente).sort()).toEqual(["bano", "cocina"]);
      expect(JSON.stringify(detalle)).not.toContain("fotos/");
      const e = await leerDetalleReserva({ usuario: { id: A.dueno.usuarioId }, reservaId: B.id, ahora }, deps).then(() => null, (x: ErrorApi) => x);
      expect(e?.status).toBe(404);

      // Historial: el conteo de A no incluye las de B.
      const hA = await listarHistorial(base, A.dueno.usuarioId, VALORES_DEL_DISENO);
      const hB = await listarHistorial(base, B.dueno.usuarioId, VALORES_DEL_DISENO);
      expect(hA.find((r) => r.id === A.id)?.total_fotos).toBe(2);
      expect(hA.find((r) => r.id === B.id)).toBeUndefined();
      expect(hB.find((r) => r.id === B.id)?.total_fotos).toBe(1);
    });

    it("una reserva no completada de su dueño no trae fotos", async () => {
      const C = await poner("confirmada");
      const detalle = await leerDetalleReserva({ usuario: { id: C.dueno.usuarioId }, reservaId: C.id, ahora: new Date("2099-01-01T00:00:00Z") }, { base: () => base, leerConfig: async () => VALORES_DEL_DISENO });
      expect(detalle.fotos).toEqual([]);
    });
  });

  describe("limpieza de huérfanos", () => {
    it("leerRutasReferenciadas incluye las rutas de fotos_servicio; limpiarHuerfanos no borra una foto en uso de 30 horas y sí un huérfano", async () => {
      const { id } = await poner("completada");
      const [foto] = await insertarDirecto(id);
      const referencias = await leerRutasReferenciadas(base);
      expect(referencias.has(foto.ruta)).toBe(true);

      const ahora = new Date("2099-01-10T12:00:00Z");
      const hace30h = new Date(ahora.getTime() - 30 * 3_600_000);
      const huerfana = `fotos/${id}/prueba-huerfana-${Date.now()}.jpg`;
      const borrados: string[] = [];
      const almacenDeLimpieza = {
        listar: async ({ prefijo }: { prefijo: string }) => ({
          elementos: prefijo === "fotos/" ? ([{ ruta: foto.ruta, subidoEn: hace30h, tamano: 10 }, { ruta: huerfana, subidoEn: hace30h, tamano: 10 }] as ElementoListado[]) : [],
          hayMas: false,
        }),
        borrar: async (ruta: string) => void borrados.push(ruta),
      };
      const r = await limpiarHuerfanos({ almacen: almacenDeLimpieza, leerReferencias: () => leerRutasReferenciadas(base), columnasDeclaradas: COLUMNAS_CON_IMAGEN.length, ahora });
      expect(r).toMatchObject({ omitido: false, borrados: 1, fallidos: 0 });
      expect(borrados).toEqual([huerfana]);
    });
  });

  it("sin rastros: no queda ninguna foto de prueba tras limpiar", async () => {
    // La verificación final está en afterAll; aquí se comprueba que la limpieza del escenario borra fotos antes que reservas.
    const { id } = await poner("completada");
    await insertarDirecto(id);
    await esc.limpiar();
    const quedan = await base.select({ id: fotosServicio.id }).from(fotosServicio).where(and(eq(fotosServicio.reservaId, id)));
    expect(quedan).toHaveLength(0);
  });
});
