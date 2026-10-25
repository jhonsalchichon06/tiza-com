import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../../__fixtures__/configuracion";
import { crearBdDoble, type Sentencia } from "../../perfil/__dobles__/bd-doble";
import { MENSAJE_MISMO_HORARIO } from "../../reservas/reprogramar";
import { MENSAJE_YA_EMPEZO, reprogramarReservaPorAdmin, type DependenciasReprogramarAdmin } from "./reprogramar";

// 2026-11-02 es lunes. AHORA = lunes 10:00 en Lima.
const AHORA = new Date("2026-11-02T15:00:00Z");
const enHoras = (h: number) => new Date(AHORA.getTime() + h * 3_600_000);
const ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "admin-1";
const NUEVO = "2026-11-06T15:00:00Z"; // viernes 10:00 en Lima, dentro de 4 días
const CHOQUE = Object.assign(new Error("Failed query"), { cause: { code: "23P01" } });
const REGISTRADA = new Date("2026-11-02T15:00:01Z");

const reserva = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  usuarioId: "u1",
  equipoId: 2,
  membresiaId: "m1",
  pagoId: "pago-1",
  estado: "confirmada",
  tipo: "profunda",
  horasTrabajo: "7.0",
  horasAgenda: "4.0",
  requiereApoyo: true,
  apoyoEstado: "por_coordinar",
  apoyoNota: null,
  inicio: enHoras(72),
  fin: enHoras(76),
  expiraEn: null,
  precioLista: 12900,
  monto: 11610,
  primeraGratis: false,
  yaEmpezo: false,
  ...extra,
});

const MEMBRESIA_ACTIVA = { estado: "activa", fin: new Date("2026-12-30T15:00:00Z") };
const MEMBRESIA_PENDIENTE = { estado: "pendiente", fin: null };

type Armado = { reserva?: Record<string, unknown>; membresia?: Record<string, unknown>; falloEn?: (s: Sentencia) => Error | undefined };
function armar({ reserva: r = reserva(), membresia = MEMBRESIA_ACTIVA, falloEn }: Armado = {}) {
  const doble = crearBdDoble(
    {
      reservas: [
        [r],
        (s) => [{ ...r, ...Object.fromEntries(Object.entries(s.set ?? {}).filter(([, v]) => v !== undefined)) }],
        (s) => [{ reprogramadaPor: s.set?.reprogramadaPor, reprogramadaEn: REGISTRADA }],
      ],
      membresias: [[membresia]],
      equipos: [[{ id: 1 }, { id: 2 }]],
    },
    { falloEn },
  );
  const dependencias: DependenciasReprogramarAdmin = { base: () => doble.base, leerConfig: async () => VALORES_DEL_DISENO };
  const reprogramar = (inicio: string | null = NUEVO, id = ID) =>
    reprogramarReservaPorAdmin({ reservaId: id, cuerpo: inicio === null ? {} : { inicio }, adminId: ADMIN_ID, ahora: AHORA }, dependencias);
  return { doble, reprogramar };
}

const escrituras = (doble: ReturnType<typeof crearBdDoble>) => doble.escrituras();

describe("reprogramarReservaPorAdmin: éxito", () => {
  it("mueve la misma fila sin filtrar por dueño y deja pago, precio y primera_gratis intactos", async () => {
    const { doble, reprogramar } = armar();
    const r = await reprogramar();
    expect(r.reserva).toMatchObject({ id: ID, estado: "confirmada", inicio: "2026-11-06T10:00:00-05:00", fin: "2026-11-06T14:00:00-05:00" });
    const select = doble.sentencias.find((s) => s.tipo === "select" && s.tabla === "reservas")!;
    expect(select.bloqueo).toBe(true);
    expect(select.donde?.params).toEqual([ID]); // sin usuario_id: el administrador no filtra por dueño
    const [mov] = escrituras(doble);
    expect(mov.set).toMatchObject({ equipoId: 2, inicio: new Date(NUEVO), fin: new Date("2026-11-06T19:00:00Z"), finBloqueo: new Date("2026-11-06T20:00:00Z") });
    for (const columna of ["estado", "expiraEn", "pagoId", "monto", "precioLista", "horasGratisAplicadas", "primeraGratis", "membresiaId", "horasTrabajo", "horasAgenda"]) {
      expect(mov.set).not.toHaveProperty(columna);
    }
  });

  it("escribe reprogramada_por (id del administrador) y reprogramada_en con el reloj de la base, en un segundo UPDATE", async () => {
    const { doble, reprogramar } = armar();
    const r = await reprogramar();
    const [, registro] = escrituras(doble);
    expect(Object.keys(registro.set!).sort()).toEqual(["reprogramadaEn", "reprogramadaPor"]);
    expect(registro.set?.reprogramadaPor).toBe(ADMIN_ID);
    expect(registro.donde?.params).toContain(ID);
    expect(r.reserva).toMatchObject({ reprogramada_por: ADMIN_ID, reprogramada_en: "2026-11-02T10:00:00-05:00" });
  });

  it("la transacción empieza con expirarVencidas", async () => {
    const { doble, reprogramar } = armar();
    await reprogramar();
    expect(doble.estado.expiraciones).toBe(1);
  });

  it("una pendiente vigente conserva su estado y su expira_en", async () => {
    const expira = enHoras(10);
    const { doble, reprogramar } = armar({ reserva: reserva({ estado: "pendiente", expiraEn: expira }), membresia: MEMBRESIA_PENDIENTE });
    const r = await reprogramar();
    expect(r.reserva.estado).toBe("pendiente");
    expect(r.reserva.expira_en).toBe("2026-11-02T20:00:00-05:00");
    expect(escrituras(doble)[0].set).not.toHaveProperty("expiraEn");
  });

  it("con 20 horas de anticipación al servicio actual SÍ se acepta (sin regla de 24 horas)", async () => {
    const { reprogramar } = armar({ reserva: reserva({ inicio: enHoras(20), fin: enHoras(24) }) });
    expect((await reprogramar()).reserva.id).toBe(ID);
  });

  it("pasa al otro equipo cuando el actual está ocupado", async () => {
    const { doble, reprogramar } = armar({ falloEn: (s) => (s.tipo === "update" && s.set?.equipoId === 2 ? CHOQUE : undefined) });
    await reprogramar();
    expect(escrituras(doble).filter((s) => s.set?.equipoId !== undefined).map((s) => s.set?.equipoId)).toEqual([2, 1]);
  });

  it("apoyo coordinado vuelve a por_coordinar con la nota intacta; sin apoyo no se toca", async () => {
    const con = armar({ reserva: reserva({ apoyoEstado: "coordinado", apoyoNota: "Rosa, 911222333" }) });
    const r = await con.reprogramar();
    expect(escrituras(con.doble)[0].set?.apoyoEstado).toBe("por_coordinar");
    expect(escrituras(con.doble)[0].set).not.toHaveProperty("apoyoNota");
    expect(r.reserva.apoyo_estado).toBe("por_coordinar");

    const sin = armar({ reserva: reserva({ requiereApoyo: false, apoyoEstado: null }) });
    const s = await sin.reprogramar();
    expect(escrituras(sin.doble)[0].set?.apoyoEstado).toBeUndefined();
    expect(s.reserva.apoyo_estado).toBeNull();
  });

  it("usa las horas_agenda guardadas aunque la configuración haya cambiado", async () => {
    // Guardadas 2 h: a las 16:00 de Lima termina a las 18:00 (cabe). Con 4 h no cabría.
    const corta = armar({ reserva: reserva({ horasAgenda: "2.0" }) });
    expect((await corta.reprogramar("2026-11-06T21:00:00Z")).reserva.fin).toBe("2026-11-06T18:00:00-05:00");
    const larga = armar({ reserva: reserva({ horasAgenda: "4.0" }) });
    await expect(larga.reprogramar("2026-11-06T21:00:00Z")).rejects.toMatchObject({ status: 422 });
  });

  it("no cancela nada ni genera crédito: solo escribe en reservas, dos sentencias", async () => {
    const { doble, reprogramar } = armar();
    await reprogramar();
    expect(escrituras(doble).map((s) => s.tabla)).toEqual(["reservas", "reservas"]);
    for (const s of escrituras(doble)) expect(s.set).not.toHaveProperty("canceladaPor");
  });
});

describe("reprogramarReservaPorAdmin: rechazos", () => {
  it("el servicio ya iniciado → 409 sin escribir", async () => {
    const { doble, reprogramar } = armar({ reserva: reserva({ yaEmpezo: true, inicio: enHoras(-1) }) });
    expect(await reprogramar().catch((e) => e)).toMatchObject({ status: 409, message: MENSAJE_YA_EMPEZO });
    expect(escrituras(doble)).toEqual([]);
  });

  it.each(["completada", "cancelada", "expirada"])("una reserva %s → 409 que nombra su estado", async (estado) => {
    const { doble, reprogramar } = armar({ reserva: reserva({ estado }) });
    const e = await reprogramar().catch((x) => x);
    expect(e.status).toBe(409);
    expect(e.message).toContain(estado);
    expect(escrituras(doble)).toEqual([]);
  });

  it("una reserva inexistente → 404 y «abc» → 404 sin abrir la transacción", async () => {
    const doble = crearBdDoble({ reservas: [[]] });
    const dependencias: DependenciasReprogramarAdmin = { base: () => doble.base, leerConfig: async () => VALORES_DEL_DISENO };
    await expect(reprogramarReservaPorAdmin({ reservaId: ID, cuerpo: { inicio: NUEVO }, adminId: ADMIN_ID, ahora: AHORA }, dependencias)).rejects.toMatchObject({ status: 404 });
    const otra = armar();
    await expect(otra.reprogramar(NUEVO, "abc")).rejects.toMatchObject({ status: 404 });
    expect(otra.doble.estado.transacciones).toBe(0);
  });

  it.each([
    ["domingo", "2026-11-08T15:00:00Z", /Atendemos de/],
    ["fuera de horario (termina después de las 6 pm)", "2026-11-06T22:00:00Z", /terminar antes de las/],
    ["no múltiplo de 30 minutos", "2026-11-06T15:15:00Z", /cada 30 minutos/],
    ["menos de 48 horas", "2026-11-03T15:00:00Z", /48 horas de anticipación/],
  ])("%s → 422 con su mensaje y sin escribir", async (_n, inicio, mensaje) => {
    const { doble, reprogramar } = armar();
    const e = await reprogramar(inicio).catch((x) => x);
    expect(e.status).toBe(422);
    expect(e.message).toMatch(mensaje);
    expect(escrituras(doble)).toEqual([]);
  });

  it("posterior al fin de la membresía activa → 422 que dice hasta qué fecha", async () => {
    const { reprogramar } = armar({ membresia: { estado: "activa", fin: new Date("2026-11-20T15:00:00Z") } });
    const e = await reprogramar("2026-11-27T15:00:00Z").catch((x) => x);
    expect(e.status).toBe(422);
    expect(e.message).toMatch(/cubre hasta el/);
  });

  it("más allá de los 3 meses de la primera membresía pendiente → 422; dentro, se acepta", async () => {
    const pendiente = { reserva: reserva({ estado: "pendiente", expiraEn: enHoras(10) }), membresia: MEMBRESIA_PENDIENTE };
    await expect(armar(pendiente).reprogramar("2027-02-12T15:00:00Z")).rejects.toMatchObject({ status: 422 });
    expect((await armar(pendiente).reprogramar("2026-12-03T15:00:00Z")).reserva.id).toBe(ID);
  });

  it("el mismo horario → 422", async () => {
    const { doble, reprogramar } = armar({ reserva: reserva({ inicio: new Date(NUEVO) }) });
    expect(await reprogramar().catch((e) => e)).toMatchObject({ status: 422, message: MENSAJE_MISMO_HORARIO });
    expect(escrituras(doble)).toEqual([]);
  });

  it("sin cupo en ningún equipo → 409 y la transacción se deshace (el horario anterior queda)", async () => {
    const { doble, reprogramar } = armar({ falloEn: (s) => (s.tipo === "update" && s.set?.equipoId ? CHOQUE : undefined) });
    const e = await reprogramar().catch((x) => x);
    expect(e).toMatchObject({ status: 409, message: "Esa hora ya no está disponible. Elige otra hora." });
    expect(doble.estado.deshecha).toBe(true);
    expect(escrituras(doble).some((s) => s.set?.reprogramadaPor !== undefined)).toBe(false);
  });

  it.each([["falta", null], ["no es una fecha", "mañana"]])("el cuerpo con inicio que %s → 422 sin abrir la transacción", async (_n, inicio) => {
    const { doble, reprogramar } = armar();
    await expect(reprogramar(inicio)).rejects.toMatchObject({ status: 422 });
    expect(doble.estado.transacciones).toBe(0);
  });
});
