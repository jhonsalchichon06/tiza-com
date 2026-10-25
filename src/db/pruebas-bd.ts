import { config } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { and, eq, inArray, isNotNull, like, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as esquema from "./esquema";
import { creditosHoras, equipos, fotosServicio, membresias, pagos, reservas, resenas, usosCredito, usuarios } from "./esquema";

// Soporte de las pruebas contra Neon (`*.bd.test.ts`). Nada de esto se importa desde la aplicación.
config({ path: ".env.local", quiet: true });
neonConfig.webSocketConstructor = ws;

export const PRUEBAS_BD_ACTIVAS = process.env.PRUEBAS_BD === "1";
const PREFIJO_USUARIO = "prueba-agenda-";
const PREFIJO_EQUIPO = "PRUEBA-agenda-";

export type BasePruebas = ReturnType<typeof crearBasePruebas>["base"];

// Con una rama de pruebas (DATABASE_URL_PRUEBAS) se usa esa; si no, la de producción con los resguardos del escenario.
export function crearBasePruebas() {
  const url = process.env.DATABASE_URL_PRUEBAS || process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL_PRUEBAS o DATABASE_URL en .env.local");
  const pool = new Pool({ connectionString: url });
  return { base: drizzle(pool, { schema: esquema }), cerrar: () => pool.end(), esRamaDePruebas: Boolean(process.env.DATABASE_URL_PRUEBAS) };
}

// Datos propios de una corrida: prefijo único, un usuario de prueba y 3 equipos INACTIVOS.
// Inactivos para que ni la agenda real ni las reservas reales los usen aunque una limpieza fallara.
export type Dueno = { usuarioId: string; membresiaId: string; pagoId: string };

// Prefijos propios de una suite (opcionales): así dos suites que corren a la vez en la misma rama no se borran ni se cuentan
// entre sí. Sin argumento, los de siempre.
export type Prefijos = { usuario?: string; equipo?: string };

export async function crearEscenario(base: BasePruebas, prefijos: Prefijos = {}) {
  const { usuario: pu = PREFIJO_USUARIO, equipo: pe = PREFIJO_EQUIPO } = prefijos;
  const id = crypto.randomUUID().slice(0, 8);
  const usuarioId = `${pu}${id}`;
  const duenoIds: string[] = [usuarioId];
  let contador = 0;
  await base.insert(usuarios).values({
    id: usuarioId,
    name: "Prueba agenda",
    email: `${usuarioId}@tiza.test`,
    telefono: "900000000",
  });
  const filas = await base
    .insert(equipos)
    .values([1, 2, 3].map((n) => ({ nombre: `${pe}${id}-${n}`, activo: false })))
    .returning({ id: equipos.id });
  const equipoIds = filas.map((f) => f.id);

  // Clientes de prueba SIN membresía ni pago (los crea la creación de la reserva en las pruebas de #9).
  async function crearClientes(cantidad: number) {
    const ids = Array.from({ length: cantidad }, () => `${pu}${id}-${++contador}`);
    duenoIds.push(...ids);
    await base.insert(usuarios).values(ids.map((u) => ({ id: u, name: "Prueba agenda", email: `${u}@tiza.test`, telefono: "900000000" })));
    return ids.map((u) => ({ id: u, correo: `${u}@tiza.test`, nombre: "Prueba agenda", celular: "900000000", rol: "cliente" as const }));
  }

  // Cada reserva viva necesita su propio cliente (una pendiente por cliente) y su propio pago (una reserva viva por pago):
  // un "dueño" es un usuario de prueba con una membresía pendiente y un pago pendiente con comprobante de prueba.
  async function crearDuenos(cantidad: number): Promise<Dueno[]> {
    const ids = Array.from({ length: cantidad }, () => `${pu}${id}-${++contador}`);
    duenoIds.push(...ids);
    await base.insert(usuarios).values(ids.map((u) => ({ id: u, name: "Prueba agenda", email: `${u}@tiza.test`, telefono: "900000000" })));
    const ms = await base
      .insert(membresias)
      .values(ids.map((u) => ({ usuarioId: u, monto: 26700, estado: "pendiente" as const })))
      .returning({ id: membresias.id, usuarioId: membresias.usuarioId });
    const ps = await base
      .insert(pagos)
      .values(
        ms.map((m) => ({
          usuarioId: m.usuarioId,
          concepto: "membresia" as const,
          membresiaId: m.id,
          monto: 26700,
          metodo: "yape" as const,
          comprobanteRuta: `comprobantes/${m.usuarioId}/prueba.jpg`,
        })),
      )
      .returning({ id: pagos.id, usuarioId: pagos.usuarioId });
    return ms.map((m) => ({ usuarioId: m.usuarioId, membresiaId: m.id, pagoId: ps.find((p) => p.usuarioId === m.usuarioId)!.id }));
  }

  // Administrador de prueba (rol admin, prefijo propio). Los pagos que revisa lo referencian en `revisado_por`.
  async function crearAdmin() {
    const adminId = `${pu}${id}-${++contador}`;
    duenoIds.push(adminId);
    await base.insert(usuarios).values({ id: adminId, name: "Prueba admin", email: `${adminId}@tiza.test`, telefono: "900000000", rol: "admin" });
    return { id: adminId };
  }

  // Miembros activos de prueba (reservar-como-miembro-activo): usuario con prefijo propio y una membresía `activa` con `inicio` y
  // `fin` fijos (fechas lejanas, así `fin > now()` de la base es verdadero). Sin pagos ni reservas: cada prueba arma los suyos.
  async function crearMiembros(cantidad: number, { inicio = "2098-12-01T10:00:00-05:00", fin = "2099-04-30T10:00:00-05:00" } = {}) {
    const ids = Array.from({ length: cantidad }, () => `${pu}${id}-${++contador}`);
    duenoIds.push(...ids);
    await base.insert(usuarios).values(ids.map((u) => ({ id: u, name: "Prueba agenda", email: `${u}@tiza.test`, telefono: "900000000" })));
    const ms = await base
      .insert(membresias)
      .values(ids.map((u) => ({ usuarioId: u, monto: 26700, estado: "activa" as const, inicio: new Date(inicio), fin: new Date(fin) })))
      .returning({ id: membresias.id, usuarioId: membresias.usuarioId });
    return ms.map((m) => ({
      usuario: { id: m.usuarioId, correo: `${m.usuarioId}@tiza.test`, nombre: "Prueba agenda", celular: "900000000", rol: "cliente" as const },
      membresiaId: m.id,
    }));
  }

  // Deja un pago `rechazado` con la fecha de rechazo fijada `horas` horas atrás (con el reloj de la base), para probar el
  // plazo de reenvío sin esperar.
  async function rechazarHace(pagoId: string, adminId: string, horas: number, motivo: string | null = null) {
    await base
      .update(pagos)
      .set({ estado: "rechazado", revisadoPor: adminId, revisadoEn: sql`now() - make_interval(secs => ${horas * 3600})`, motivoRechazo: motivo })
      .where(eq(pagos.id, pagoId));
  }

  // Una reserva de un cliente nuevo (con su membresía y pago de prueba) en el estado pedido. Cada una cae en un día distinto de
  // 2098 (equipos inactivos, sin choques) para poder crear varias. Sirve para las reseñas: `completada` es la única reseñable.
  let diaDeReserva = 0;
  async function crearReservaEn(estado: NonNullable<Opciones["estado"]>) {
    const dueno = await crearDueno();
    const inicio = new Date(Date.UTC(2098, 2, 1 + ++diaDeReserva, 15, 0, 0)).toISOString();
    const [reserva] = await base
      .insert(reservas)
      .values(filaReserva({ ...dueno, equipoId: equipoIds[0], inicio, horasAgenda: 2, estado }))
      .returning({ id: reservas.id });
    return { usuarioId: dueno.usuarioId, reservaId: reserva.id, usuario: { id: dueno.usuarioId, correo: `${dueno.usuarioId}@tiza.test`, nombre: "Prueba agenda", celular: "900000000", rol: "cliente" as const } };
  }
  const crearDueno = async () => (await crearDuenos(1))[0];

  // --- Crédito en horas (ítem 14) ---
  // Un lote con `vence_en` y horas fijadas. Su reserva de origen es una cancelada por el cliente con un pago interno aprobado
  // (el lote exige una reserva de origen única). `venceEn` puede ser un instante o una expresión SQL (por ejemplo, un minuto antes
  // de `now()`, para probar que un lote vencido no se aplica).
  let diaDeLote = 0;
  async function crearLote(
    miembro: { usuarioId: string; membresiaId: string },
    { horas, disponibles = horas, venceEn = new Date("2099-06-01T15:00:00Z") }: { horas: number; disponibles?: number; venceEn?: Date | SQL },
  ) {
    const [pago] = await base
      .insert(pagos)
      .values({ usuarioId: miembro.usuarioId, concepto: "reserva", membresiaId: null, monto: 0, metodo: "credito", comprobanteRuta: null, estado: "aprobado" })
      .returning({ id: pagos.id });
    const inicio = new Date(Date.UTC(2097, 0, 1 + ++diaDeLote, 15, 0, 0)).toISOString();
    const [reserva] = await base
      .insert(reservas)
      .values({ ...filaReserva({ usuarioId: miembro.usuarioId, membresiaId: miembro.membresiaId, pagoId: pago.id, equipoId: equipoIds[0], inicio, horasAgenda: horas, estado: "cancelada" }), canceladaPor: "cliente", canceladaEn: new Date() })
      .returning({ id: reservas.id });
    const [fila] = await base
      .insert(creditosHoras)
      .values({ usuarioId: miembro.usuarioId, reservaOrigenId: reserva.id, horasIniciales: String(horas), horasDisponibles: String(disponibles), venceEn })
      .returning({ id: creditosHoras.id });
    return { loteId: fila.id, reservaOrigenId: reserva.id, pagoId: pago.id };
  }

  // Una reserva en el estado pedido con un pago en el estado pedido (`aprobado`, `pendiente` o `rechazado`), de un miembro.
  // Cada una cae en un día distinto de 2096 (equipos inactivos, sin choques). `credito` y `gratis` son horas ya aplicadas.
  let diaDeReservaDePrueba = 0;
  async function crearReservaDePrueba(
    miembro: { usuarioId: string; membresiaId: string },
    { estado, estadoPago, horas = 4, gratis = 0, credito = 0, expiraEn, canceladaPor, adminId }: {
      estado: "pendiente" | "confirmada" | "cancelada" | "expirada" | "completada";
      estadoPago: "aprobado" | "pendiente" | "rechazado";
      horas?: number;
      gratis?: number;
      credito?: number;
      expiraEn?: Date | null;
      canceladaPor?: "cliente" | "admin";
      adminId?: string;
    },
  ) {
    const revisado = estadoPago === "pendiente" ? {} : { revisadoPor: adminId ?? null, revisadoEn: new Date() };
    if (estadoPago === "rechazado" && !adminId) throw new Error("Un pago rechazado necesita un administrador revisor");
    const [pago] = await base
      .insert(pagos)
      .values({ usuarioId: miembro.usuarioId, concepto: "reserva", membresiaId: null, monto: 11610, metodo: "yape", comprobanteRuta: `comprobantes/${miembro.usuarioId}/prueba.jpg`, estado: estadoPago, ...revisado })
      .returning({ id: pagos.id });
    const inicio = new Date(Date.UTC(2096, 0, 1 + ++diaDeReservaDePrueba, 15, 0, 0)).toISOString();
    const [reserva] = await base
      .insert(reservas)
      .values({
        ...filaReserva({ usuarioId: miembro.usuarioId, membresiaId: miembro.membresiaId, pagoId: pago.id, equipoId: equipoIds[0], inicio, horasAgenda: horas, estado, expiraEn }),
        horasGratisAplicadas: String(gratis),
        creditoAplicado: String(credito),
        ...(estado === "cancelada" ? { canceladaPor: canceladaPor ?? "cliente", canceladaEn: new Date() } : {}),
      })
      .returning({ id: reservas.id });
    return { reservaId: reserva.id, pagoId: pago.id };
  }

  return {
    usuarioId,
    equipoIds,
    crearReservaEn,
    crearLote,
    crearReservaDePrueba,
    crearDuenos,
    crearClientes,
    crearAdmin,
    crearMiembros,
    rechazarHace,
    crearDueno: async () => (await crearDuenos(1))[0],
    // Reservas, pagos, membresías, usuarios y equipos del escenario, en ese orden (FK sin cascada). Sirve aunque algo falle a medias.
    async limpiar() {
      // Las reseñas apuntan a la reserva y al administrador que las revisó: primero ellas.
      await base.delete(resenas).where(inArray(resenas.reservaId, base.select({ id: reservas.id }).from(reservas).where(inArray(reservas.usuarioId, duenoIds))));
      // Las fotos del servicio (ítem 17) apuntan a la reserva y al administrador que las subió: también antes que las reservas.
      await base.delete(fotosServicio).where(inArray(fotosServicio.reservaId, base.select({ id: reservas.id }).from(reservas).where(inArray(reservas.usuarioId, duenoIds))));
      await base.delete(fotosServicio).where(inArray(fotosServicio.subidaPor, duenoIds));
      await borrarCreditos(base, duenoIds);
      await base.delete(reservas).where(inArray(reservas.usuarioId, duenoIds));
      // Los pagos de reenvío apuntan al rechazado (`reemplaza_a`): se sueltan antes de borrar.
      await base.update(pagos).set({ reemplazaA: null }).where(and(inArray(pagos.usuarioId, duenoIds), isNotNull(pagos.reemplazaA)));
      await base.delete(pagos).where(inArray(pagos.usuarioId, duenoIds));
      await base.delete(membresias).where(inArray(membresias.usuarioId, duenoIds));
      await base.delete(usuarios).where(inArray(usuarios.id, duenoIds));
      await base.delete(equipos).where(inArray(equipos.id, equipoIds));
    },
  };
}

// Crédito en horas (ítem 14): los usos y los lotes apuntan a la reserva, así que se borran antes que ella. Cubre los lotes de
// los usuarios dados y los usos de sus reservas (de destino o de origen), aunque el lote sea de otro usuario.
export async function borrarCreditos(base: BasePruebas, usuarioIds: string[]) {
  if (usuarioIds.length === 0) return;
  const reservasDe = base.select({ id: reservas.id }).from(reservas).where(inArray(reservas.usuarioId, usuarioIds));
  const lotesDe = base
    .select({ id: creditosHoras.id })
    .from(creditosHoras)
    .where(sql`${creditosHoras.usuarioId} IN ${usuarioIds} OR ${creditosHoras.reservaOrigenId} IN (${reservasDe})`);
  await base.delete(usosCredito).where(sql`${usosCredito.creditoId} IN (${lotesDe}) OR ${usosCredito.reservaDestinoId} IN (${reservasDe})`);
  await base.delete(creditosHoras).where(sql`${creditosHoras.usuarioId} IN ${usuarioIds} OR ${creditosHoras.reservaOrigenId} IN (${reservasDe})`);
}

// Cuenta los lotes de crédito de los usuarios dados (para que una suite mida SOLO sus rastros, sin el conteo global).
export async function contarCreditos(base: BasePruebas, usuarioIds: string[]): Promise<number> {
  if (usuarioIds.length === 0) return 0;
  const filas = await base.select({ id: creditosHoras.id }).from(creditosHoras).where(inArray(creditosHoras.usuarioId, usuarioIds));
  return filas.length;
}

// Filas que quedan de CUALQUIER corrida (por prefijo). Debe ser 0 al terminar.
export async function contarRastros(base: BasePruebas, { usuario: pu = PREFIJO_USUARIO, equipo: pe = PREFIJO_EQUIPO }: Prefijos = {}): Promise<number> {
  const [u, e] = await Promise.all([
    base.select({ id: usuarios.id }).from(usuarios).where(like(usuarios.id, `${pu}%`)),
    base.select({ id: equipos.id }).from(equipos).where(like(equipos.nombre, `${pe}%`)),
  ]);
  const ids = u.map((x) => x.id);
  const [r, p, m, rs, ft] = ids.length
    ? await Promise.all([
        base.select({ id: reservas.id }).from(reservas).where(inArray(reservas.usuarioId, ids)),
        base.select({ id: pagos.id }).from(pagos).where(inArray(pagos.usuarioId, ids)),
        base.select({ id: membresias.id }).from(membresias).where(inArray(membresias.usuarioId, ids)),
        base.select({ id: resenas.id }).from(resenas).where(inArray(resenas.reservaId, base.select({ id: reservas.id }).from(reservas).where(inArray(reservas.usuarioId, ids)))),
        base.select({ id: fotosServicio.id }).from(fotosServicio).where(inArray(fotosServicio.subidaPor, ids)),
      ])
    : [[], [], [], [], []];
  return u.length + e.length + r.length + p.length + m.length + rs.length + ft.length + (await contarCreditos(base, ids));
}

// Borra por prefijo todo rastro (también de corridas anteriores que se cortaron).
export async function limpiarRastros(base: BasePruebas, { usuario: pu = PREFIJO_USUARIO, equipo: pe = PREFIJO_EQUIPO }: Prefijos = {}) {
  const u = await base.select({ id: usuarios.id }).from(usuarios).where(like(usuarios.id, `${pu}%`));
  const ids = u.map((x) => x.id);
  if (ids.length) {
    await base.delete(resenas).where(inArray(resenas.reservaId, base.select({ id: reservas.id }).from(reservas).where(inArray(reservas.usuarioId, ids))));
    await base.delete(fotosServicio).where(inArray(fotosServicio.reservaId, base.select({ id: reservas.id }).from(reservas).where(inArray(reservas.usuarioId, ids))));
    await base.delete(fotosServicio).where(inArray(fotosServicio.subidaPor, ids));
    await borrarCreditos(base, ids);
    await base.delete(reservas).where(inArray(reservas.usuarioId, ids));
    await base.update(pagos).set({ reemplazaA: null }).where(and(inArray(pagos.usuarioId, ids), isNotNull(pagos.reemplazaA)));
    await base.delete(pagos).where(inArray(pagos.usuarioId, ids));
    await base.delete(membresias).where(inArray(membresias.usuarioId, ids));
  }
  await base.delete(usuarios).where(and(like(usuarios.id, `${pu}%`)));
  await base.delete(equipos).where(like(equipos.nombre, `${pe}%`));
}

type Opciones = {
  usuarioId: string;
  membresiaId: string;
  pagoId: string;
  equipoId: number;
  inicio: string; // ISO con zona, p. ej. "2099-01-05T10:00:00-05:00"
  horasAgenda: number;
  traslado?: number;
  estado?: "pendiente" | "confirmada" | "completada" | "cancelada" | "expirada";
  expiraEn?: Date | null;
  primeraGratis?: boolean;
  distrito?: string;
  calle?: string;
  numero?: string;
  direccionNormalizada?: string;
  departamentoNormalizado?: string;
};

// Una reserva válida de una estándar de 2 dormitorios y 1 baño; las pruebas cambian lo que necesitan.
export function filaReserva(o: Opciones): typeof reservas.$inferInsert {
  const inicio = new Date(o.inicio);
  const fin = new Date(inicio.getTime() + o.horasAgenda * 3_600_000);
  const finBloqueo = new Date(fin.getTime() + (o.traslado ?? 1) * 3_600_000);
  const estado = o.estado ?? "confirmada";
  return {
    usuarioId: o.usuarioId,
    membresiaId: o.membresiaId,
    pagoId: o.pagoId,
    equipoId: o.equipoId,
    tipo: "estandar",
    dormitorios: 2,
    banos: 1,
    horasTrabajo: String(o.horasAgenda),
    horasAgenda: String(o.horasAgenda),
    distrito: o.distrito ?? "Miraflores",
    calle: o.calle ?? "Av. Larco",
    numero: o.numero ?? "123",
    direccionNormalizada: o.direccionNormalizada ?? "avenida larco 123",
    ...(o.departamentoNormalizado !== undefined ? { departamentoNormalizado: o.departamentoNormalizado } : {}),
    ...(o.primeraGratis !== undefined ? { primeraGratis: o.primeraGratis } : {}),
    inicio,
    fin,
    finBloqueo,
    precioLista: 12900,
    descuento: 1290,
    monto: 11610,
    estado,
    expiraEn: o.expiraEn !== undefined ? o.expiraEn : estado === "pendiente" ? new Date(Date.now() + 24 * 3_600_000) : null,
  };
}

class Deshacer extends Error {}

// Ejecuta `fn` en una transacción y la deshace al final, haya o no error: no deja nada en la base.
export async function enRollback<T>(base: BasePruebas, fn: (tx: Parameters<Parameters<BasePruebas["transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
  let resultado!: T;
  try {
    await base.transaction(async (tx) => {
      resultado = await fn(tx);
      throw new Deshacer();
    });
  } catch (error) {
    if (!(error instanceof Deshacer)) throw error;
  }
  return resultado;
}

// Intenta insertar dentro de un SAVEPOINT para que un rechazo no aborte la transacción de la prueba.
// Devuelve "ok" o el código SQLSTATE del rechazo (Drizzle lo deja en `cause`).
export async function intentarInsertar(
  tx: Parameters<Parameters<BasePruebas["transaction"]>[0]>[0],
  fila: typeof reservas.$inferInsert,
): Promise<string> {
  try {
    await tx.transaction(async (sp) => {
      await sp.insert(reservas).values(fila);
    });
    return "ok";
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code ?? "error";
  }
}
