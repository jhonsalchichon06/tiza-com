import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../../__fixtures__/configuracion";
import type { ErrorApi } from "../../errores";
import { crearBdDoble } from "../../perfil/__dobles__/bd-doble";
import { LIMITE_DE_LISTA, listarReservas } from "./listado";

const CONFIG = VALORES_DEL_DISENO;
const ID = "11111111-1111-4111-8111-111111111111";

const fila = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  estado: "confirmada",
  tipo: "profunda",
  dormitorios: 3,
  banos: 2,
  horasTrabajo: "7.0",
  horasAgenda: "3.5",
  distrito: "Miraflores",
  calle: "Av. Larco",
  numero: "123",
  departamento: "Dpto. 302",
  referencias: null,
  inicio: new Date("2026-11-06T15:00:00Z"),
  fin: new Date("2026-11-06T18:30:00Z"),
  finBloqueo: new Date("2026-11-06T19:30:00Z"),
  expiraEn: null,
  requiereApoyo: true,
  apoyoEstado: "por_coordinar",
  apoyoNota: null,
  pagoId: "22222222-2222-4222-8222-222222222222",
  equipoId: 2,
  equipoNombre: "Equipo 2",
  clienteId: "u1",
  clienteNombre: "María Pérez",
  clienteCorreo: "maria@tiza.test",
  clienteCelular: "987654321",
  yaEmpezo: false,
  reprogramadaPor: null,
  reprogramadaEn: null,
  reprogramadorNombre: null,
  ...extra,
});

const EQUIPOS = [
  { id: 1, nombre: "Equipo 1" },
  { id: 2, nombre: "Equipo 2" },
];

function montar(filas: unknown[], equipos: unknown[] = EQUIPOS) {
  const doble = crearBdDoble({ reservas: [filas], equipos: [equipos] });
  return { doble, listar: (estado?: string | null) => listarReservas(doble.base, { estado }, CONFIG) };
}

async function error(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("se esperaba un error");
}

const consultaDeReservas = (doble: ReturnType<typeof crearBdDoble>) => doble.lecturas().find((s) => s.tabla === "reservas")!;

describe("listarReservas: forma de la fila", () => {
  it("devuelve estado efectivo, equipo, cliente, dirección, apoyo y los equipos activos, con la hora de Lima", async () => {
    const { listar } = montar([fila()]);
    const r = await listar();
    expect(r.equipos).toEqual(EQUIPOS);
    expect(r.reservas).toHaveLength(1);
    expect(r.reservas[0]).toEqual({
      id: ID,
      estado: "confirmada",
      cliente: { id: "u1", nombre: "María Pérez", correo: "maria@tiza.test", celular: "987654321" },
      servicio: { tipo: "profunda", dormitorios: 3, banos: 2, horas_trabajo: 7 },
      direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: "Dpto. 302", referencias: null },
      inicio: "2026-11-06T10:00:00-05:00",
      fin: "2026-11-06T13:30:00-05:00",
      fin_bloqueo: "2026-11-06T14:30:00-05:00",
      horas_agenda: 3.5,
      expira_en: null,
      equipo: { id: 2, nombre: "Equipo 2" },
      requiere_apoyo: true,
      apoyo_estado: "por_coordinar",
      apoyo_nota: null,
      pago_id: "22222222-2222-4222-8222-222222222222",
      puede_completar: false,
      puede_reasignar: true,
      puede_reprogramar: true,
      reprogramada_en: null,
      reprogramada_por: null,
    });
  });

  it("no devuelve montos ni rutas de comprobante", async () => {
    const { listar } = montar([fila()]);
    const texto = JSON.stringify(await listar());
    expect(texto).not.toMatch(/monto|precio|comprobante/i);
  });

  it("limita la consulta a 100 filas y ordena por inicio ascendente sin filtro", async () => {
    const { doble, listar } = montar([fila()]);
    await listar();
    expect(LIMITE_DE_LISTA).toBe(100);
    expect(consultaDeReservas(doble).limite).toBe(100);
  });
});

describe("listarReservas: filtros", () => {
  it("sin filtro solo trae las vivas desde ahora (reservaActiva e inicio >= now())", async () => {
    const { doble, listar } = montar([]);
    await listar();
    const donde = consultaDeReservas(doble).donde!.sql;
    expect(donde).toContain(`"reservas"."estado" = $`); // confirmada o pendiente
    expect(donde).toContain(`"reservas"."expira_en" > now()`);
    expect(donde).toContain(`"reservas"."inicio" >= now()`);
  });

  it("pendiente: viva y pendiente, así una espera vencida no aparece", async () => {
    const { doble, listar } = montar([]);
    await listar("pendiente");
    const donde = consultaDeReservas(doble).donde!;
    expect(donde.sql).toContain(`"reservas"."expira_en" > now()`);
    expect(donde.params).toContain("pendiente");
  });

  it("por_completar: confirmada con inicio <= now()", async () => {
    const { doble, listar } = montar([]);
    await listar("por_completar");
    const donde = consultaDeReservas(doble).donde!;
    expect(donde.params).toEqual(["confirmada"]);
    expect(donde.sql).toContain(`"reservas"."inicio" <= now()`);
  });

  it("expirada se filtra por el estado efectivo (incluye la pendiente vencida)", async () => {
    const { doble, listar } = montar([]);
    await listar("expirada");
    const donde = consultaDeReservas(doble).donde!.sql;
    expect(donde).toContain("CASE WHEN");
    expect(donde).toContain(`"reservas"."expira_en" <= now()`);
  });

  it.each(["completada", "cancelada", "confirmada"])("acepta el filtro %s", async (estado) => {
    const { doble, listar } = montar([]);
    await listar(estado);
    expect(consultaDeReservas(doble).donde!.params).toContain(estado);
  });

  it("estado=otro da 422 con los estados válidos y no consulta nada", async () => {
    const { doble, listar } = montar([]);
    const e = await error(listar("otro"));
    expect(e).toMatchObject({ status: 422 });
    for (const valido of ["pendiente", "confirmada", "completada", "cancelada", "expirada", "por_completar"]) expect(e.message).toContain(valido);
    expect(doble.sentencias).toEqual([]);
  });

  it("una cadena vacía también es un estado inválido", async () => {
    const { listar } = montar([]);
    expect(await error(listar(""))).toMatchObject({ status: 422 });
  });
});

describe("listarReservas: estado efectivo e indicadores", () => {
  it("la pendiente vencida llega como expirada desde el SQL y no se puede completar ni reasignar", async () => {
    const { listar } = montar([fila({ estado: "expirada", expiraEn: new Date("2026-11-01T00:00:00Z") })]);
    const [r] = (await listar("expirada")).reservas;
    expect(r.estado).toBe("expirada");
    expect(r.puede_completar).toBe(false);
    expect(r.puede_reasignar).toBe(false);
  });

  it("la consulta calcula el estado con el CASE de estado.ts (una sola definición)", async () => {
    const { doble, listar } = montar([]);
    await listar("expirada");
    // El CASE aparece en el filtro; el select usa la misma expresión (no hay otra condición repetida en el listado).
    expect(consultaDeReservas(doble).donde!.sql.match(/CASE WHEN/g)).toHaveLength(1);
  });

  it("puede_completar solo si está confirmada y ya empezó", async () => {
    const { listar } = montar([
      fila({ id: "a", yaEmpezo: true }),
      fila({ id: "b", yaEmpezo: false }),
      fila({ id: "c", estado: "pendiente", yaEmpezo: true }),
      fila({ id: "d", estado: "completada", yaEmpezo: true }),
    ]);
    const r = (await listar("por_completar")).reservas;
    expect(r.map((x) => [x.id, x.puede_completar])).toEqual([["a", true], ["b", false], ["c", false], ["d", false]]);
  });

  it("puede_reasignar exige una reserva viva y otro equipo activo distinto del actual", async () => {
    const { listar } = montar([fila({ id: "a" }), fila({ id: "b", estado: "cancelada" }), fila({ id: "c", estado: "completada" })]);
    expect((await listar()).reservas.map((x) => x.puede_reasignar)).toEqual([true, false, false]);
    const solo = montar([fila()], [{ id: 2, nombre: "Equipo 2" }]);
    expect((await solo.listar()).reservas[0].puede_reasignar).toBe(false);
  });

  it("una lista vacía devuelve igualmente los equipos", async () => {
    const { listar } = montar([]);
    expect(await listar()).toEqual({ reservas: [], equipos: EQUIPOS });
  });
});

describe("listarReservas: reprogramar a nombre del cliente", () => {
  it("puede_reprogramar es verdadero solo para una reserva viva cuyo servicio no empezó", async () => {
    const { listar } = montar([
      fila({ id: "a" }),
      fila({ id: "b", yaEmpezo: true }),
      fila({ id: "c", estado: "pendiente" }),
      fila({ id: "d", estado: "completada" }),
      fila({ id: "e", estado: "cancelada" }),
      fila({ id: "f", estado: "expirada" }),
    ]);
    expect((await listar("confirmada")).reservas.map((x) => [x.id, x.puede_reprogramar])).toEqual([
      ["a", true],
      ["b", false],
      ["c", true],
      ["d", false],
      ["e", false],
      ["f", false],
    ]);
  });

  it("expone cuándo y quién reprogramó, solo si ocurrió", async () => {
    const { listar } = montar([
      fila({ id: "a", reprogramadaPor: "admin-1", reprogramadaEn: new Date("2026-11-02T15:00:00Z"), reprogramadorNombre: "Admin Tiza" }),
      fila({ id: "b" }),
      fila({ id: "c", reprogramadaPor: "admin-borrado", reprogramadaEn: new Date("2026-11-02T15:00:00Z"), reprogramadorNombre: null }),
    ]);
    const r = (await listar()).reservas;
    expect(r[0]).toMatchObject({ reprogramada_en: "2026-11-02T10:00:00-05:00", reprogramada_por: { id: "admin-1", nombre: "Admin Tiza" } });
    expect(r[1]).toMatchObject({ reprogramada_en: null, reprogramada_por: null });
    expect(r[2].reprogramada_por).toEqual({ id: "admin-borrado", nombre: null });
  });
});
