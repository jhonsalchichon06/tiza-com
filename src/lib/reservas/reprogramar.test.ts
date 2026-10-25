import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { crearBdDoble, type Guion, type Sentencia } from "../perfil/__dobles__/bd-doble";
import type { Usuario } from "../sesion";
import { ErrorFueraDePlazo } from "./cancelar";
import {
  MENSAJE_MISMO_HORARIO,
  MENSAJE_NO_REPROGRAMABLE,
  reprogramarReserva,
  type DependenciasReprogramar,
} from "./reprogramar";

// 2026-11-02 es lunes. AHORA = lunes 10:00 en Lima.
const AHORA = new Date("2026-11-02T15:00:00Z");
const enHoras = (h: number) => new Date(AHORA.getTime() + h * 3_600_000);
const ID = "11111111-1111-4111-8111-111111111111";
const USUARIO: Usuario = { id: "u1", correo: "a@tiza.test", nombre: "Ana", celular: "999111222", rol: "cliente" };
const NUEVO = "2026-11-06T15:00:00Z"; // viernes 10:00 en Lima, dentro de 4 días
const CHOQUE = Object.assign(new Error("Failed query"), { cause: { code: "23P01" } });

const reserva = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  usuarioId: "u1",
  equipoId: 2,
  membresiaId: "m1",
  pagoId: "pago-1",
  estado: "confirmada",
  tipo: "estandar",
  horasTrabajo: "4.0",
  horasAgenda: "4.0",
  requiereApoyo: false,
  apoyoEstado: null,
  apoyoNota: null,
  distrito: "Miraflores",
  calle: "Av. Larco",
  numero: "123",
  departamento: null,
  inicio: enHoras(72), // jueves 5 de noviembre, 10:00
  fin: enHoras(76),
  expiraEn: null,
  precioLista: 12900,
  monto: 11610,
  primeraGratis: false,
  ...extra,
});

const MEMBRESIA_ACTIVA = { estado: "activa", fin: new Date("2026-12-30T15:00:00Z") };
const MEMBRESIA_PENDIENTE = { estado: "pendiente", fin: null };

type Armado = { reserva?: Record<string, unknown>; membresia?: Record<string, unknown>; numero?: string | null; falloEn?: (s: Sentencia) => Error | undefined; guion?: Guion };
function armar({ reserva: r = reserva(), membresia = MEMBRESIA_ACTIVA, numero = "51987654321", falloEn }: Armado = {}) {
  const doble = crearBdDoble(
    {
      reservas: [[r], (s) => [{ ...r, ...s.set }]],
      membresias: [[membresia]],
      equipos: [[{ id: 1 }, { id: 2 }]],
    },
    { falloEn },
  );
  const dependencias: DependenciasReprogramar = {
    base: () => doble.base,
    leerConfig: async () => VALORES_DEL_DISENO,
    numeroWhatsapp: () => numero,
  };
  const reprogramar = (inicio: string | undefined = NUEVO, id = ID) =>
    reprogramarReserva({ usuario: USUARIO, reservaId: id, cuerpo: inicio === undefined ? {} : { inicio }, ahora: AHORA }, dependencias);
  return { doble, reprogramar };
}

const movimientos = (doble: ReturnType<typeof crearBdDoble>) => doble.escrituras().filter((s) => s.tabla === "reservas");

describe("reprogramarReserva: éxito", () => {
  it("mueve la misma fila: equipo actual primero, nuevo horario con el traslado y nada más cambia", async () => {
    const { doble, reprogramar } = armar();
    const r = await reprogramar();
    expect(r.reserva).toMatchObject({ id: ID, estado: "confirmada", inicio: "2026-11-06T10:00:00-05:00", fin: "2026-11-06T14:00:00-05:00" });
    const [mov] = movimientos(doble);
    expect(mov.set).toMatchObject({ equipoId: 2, inicio: new Date(NUEVO), fin: new Date("2026-11-06T19:00:00Z"), finBloqueo: new Date("2026-11-06T20:00:00Z") });
    for (const columna of ["estado", "expiraEn", "pagoId", "monto", "precioLista", "horasGratisAplicadas", "primeraGratis", "membresiaId"]) {
      expect(mov.set).not.toHaveProperty(columna);
    }
    expect(mov.donde?.params).toContain(ID);
  });

  it("la transacción empieza con expirarVencidas y el SELECT lleva FOR UPDATE y el usuario_id", async () => {
    const { doble, reprogramar } = armar();
    await reprogramar();
    expect(doble.estado.expiraciones).toBe(1);
    const select = doble.sentencias.find((s) => s.tipo === "select" && s.tabla === "reservas")!;
    expect(select.bloqueo).toBe(true);
    expect(select.donde?.params).toEqual(expect.arrayContaining([ID, "u1"]));
  });

  it("una pendiente vigente conserva su estado y su expira_en", async () => {
    const expira = enHoras(10);
    const { doble, reprogramar } = armar({ reserva: reserva({ estado: "pendiente", expiraEn: expira }), membresia: MEMBRESIA_PENDIENTE });
    const r = await reprogramar();
    expect(r.reserva.estado).toBe("pendiente");
    expect(r.reserva.expira_en).toBe("2026-11-02T20:00:00-05:00");
    expect(movimientos(doble)[0].set).not.toHaveProperty("expiraEn");
  });

  it("pasa al otro equipo cuando el actual está ocupado", async () => {
    const { doble, reprogramar } = armar({ falloEn: (s) => (s.tipo === "update" && s.set?.equipoId === 2 ? CHOQUE : undefined) });
    await reprogramar();
    expect(movimientos(doble).map((s) => s.set?.equipoId)).toEqual([2, 1]);
    expect(doble.estado.savepoints).toBe(2);
  });

  it("sin cupo en ningún equipo: 409 y no queda nada escrito", async () => {
    const { doble, reprogramar } = armar({ falloEn: (s) => (s.tipo === "update" && s.set?.equipoId ? CHOQUE : undefined) });
    const error = await reprogramar().catch((e) => e);
    expect(error).toMatchObject({ status: 409, message: "Esa hora ya no está disponible. Elige otra hora." });
    expect(doble.estado.deshecha).toBe(true);
  });

  it("apoyo coordinado vuelve a por_coordinar y la nota no se toca", async () => {
    const { doble, reprogramar } = armar({ reserva: reserva({ requiereApoyo: true, apoyoEstado: "coordinado", apoyoNota: "Rosa" }) });
    const r = await reprogramar();
    expect(movimientos(doble)[0].set?.apoyoEstado).toBe("por_coordinar");
    expect(movimientos(doble)[0].set).not.toHaveProperty("apoyoNota");
    expect(r.reserva.apoyo_estado).toBe("por_coordinar");
  });

  it("sin apoyo, apoyo_estado no se toca", async () => {
    const { doble, reprogramar } = armar();
    await reprogramar();
    expect(movimientos(doble)[0].set?.apoyoEstado).toBeUndefined();
  });

  it("valida con las horas_agenda guardadas aunque la configuración haya cambiado", async () => {
    // Guardadas 2 h: a las 16:00 de Lima termina a las 18:00 (cabe). Con 4 h no cabría.
    const { reprogramar } = armar({ reserva: reserva({ horasAgenda: "2.0" }) });
    const r = await reprogramar("2026-11-06T21:00:00Z");
    expect(r.reserva.fin).toBe("2026-11-06T18:00:00-05:00");
    const { reprogramar: largo } = armar({ reserva: reserva({ horasAgenda: "4.0" }) });
    await expect(largo("2026-11-06T21:00:00Z")).rejects.toMatchObject({ status: 422 });
  });

  it("dentro de los 3 meses de la primera membresía pendiente se acepta", async () => {
    const { reprogramar } = armar({ reserva: reserva({ estado: "pendiente", expiraEn: enHoras(10) }), membresia: MEMBRESIA_PENDIENTE });
    expect((await reprogramar("2026-12-03T15:00:00Z")).reserva.id).toBe(ID);
  });
});

describe("reprogramarReserva: rechazos", () => {
  it("20 horas antes del servicio actual: 409 fuera_de_plazo con WhatsApp y sin escribir", async () => {
    const { doble, reprogramar } = armar({ reserva: reserva({ inicio: enHoras(20), fin: enHoras(24) }) });
    const error = await reprogramar().catch((e) => e);
    expect(error).toBeInstanceOf(ErrorFueraDePlazo);
    expect(error).toMatchObject({ status: 409, codigo: "fuera_de_plazo", message: "Solo puedes cambiar el horario hasta 24 horas antes del servicio. Si necesitas ayuda, escríbenos por WhatsApp." });
    expect(error.whatsapp).toMatch(/^https:\/\/wa\.me\/51987654321/);
    expect(movimientos(doble)).toEqual([]);
  });

  it.each([
    ["domingo", "2026-11-08T15:00:00Z", /Atendemos de lunes a sábado/],
    ["fuera de horario (terminaría después de las 6 pm)", "2026-11-06T22:00:00Z", /horario de atención es de 8 am a 6 pm/],
    ["no múltiplo de 30 minutos", "2026-11-06T15:10:00Z", /cada 30 minutos/],
    ["menos de 48 horas", "2026-11-03T16:00:00Z", /^Reserva con al menos 48 horas de anticipación\.$/],
  ])("%s: 422 con su mensaje", async (_n, inicio, mensaje) => {
    const { doble, reprogramar } = armar();
    const error = await reprogramar(inicio).catch((e) => e);
    expect(error.status).toBe(422);
    expect(error.message).toMatch(mensaje);
    expect(movimientos(doble)).toEqual([]);
  });

  it("posterior al fin de la membresía activa: 422 con la fecha límite", async () => {
    const { reprogramar } = armar();
    const error = await reprogramar("2027-01-05T15:00:00Z").catch((e) => e);
    expect(error).toMatchObject({ status: 422, message: "Tu membresía cubre hasta el 30 de diciembre de 2026. Elige una fecha anterior." });
  });

  it("fuera de los 3 meses de la primera membresía pendiente: 422", async () => {
    const { reprogramar } = armar({ reserva: reserva({ estado: "pendiente", expiraEn: enHoras(10) }), membresia: MEMBRESIA_PENDIENTE });
    const error = await reprogramar("2027-03-02T15:00:00Z").catch((e) => e);
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/Con tu primera membresía puedes reservar hasta el/);
  });

  it("el mismo horario: 422", async () => {
    const { reprogramar } = armar();
    const error = await reprogramar(enHoras(72).toISOString()).catch((e) => e);
    expect(error).toMatchObject({ status: 422, message: MENSAJE_MISMO_HORARIO });
  });

  it.each(["completada", "cancelada", "expirada"] as const)("%s: 409 con su mensaje y sin escribir", async (estado) => {
    const { doble, reprogramar } = armar({ reserva: reserva({ estado }) });
    const error = await reprogramar().catch((e) => e);
    expect(error).toMatchObject({ status: 409, message: MENSAJE_NO_REPROGRAMABLE[estado] });
    expect(movimientos(doble)).toEqual([]);
  });

  it("reserva ajena o inexistente: 404", async () => {
    const doble = crearBdDoble({ reservas: [[]] });
    const error = await reprogramarReserva(
      { usuario: USUARIO, reservaId: ID, cuerpo: { inicio: NUEVO }, ahora: AHORA },
      { base: () => doble.base, leerConfig: async () => VALORES_DEL_DISENO, numeroWhatsapp: () => null },
    ).catch((e) => e);
    expect(error.status).toBe(404);
  });

  it("id sin formato de uuid: 404 sin abrir transacción", async () => {
    const { doble, reprogramar } = armar();
    expect((await reprogramar(NUEVO, "abc").catch((e) => e)).status).toBe(404);
    expect(doble.estado.transacciones).toBe(0);
  });

  it.each(["", "mañana", "2026-02-30T10:00:00Z", "2026-11-06T10:00:00"])("cuerpo inválido %j: 422 sin abrir transacción", async (inicio) => {
    const { doble, reprogramar } = armar();
    const error = await reprogramar(inicio).catch((e) => e);
    expect(error.status).toBe(422);
    expect(doble.estado.transacciones).toBe(0);
  });
});
