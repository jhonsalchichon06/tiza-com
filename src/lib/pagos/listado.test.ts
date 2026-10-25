import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import type { ErrorApi } from "../errores";
import { render } from "./__dobles__/tx-doble";
import { detalleDePago, listarPagos, LIMITE_DE_LISTA } from "./listado";

const CONFIG = VALORES_DEL_DISENO;
const ID = "11111111-1111-4111-8111-111111111111";

// Doble de `select`: una cola de resultados (uno por consulta) y el registro de lo que se pidió.
function crearBase(...resultados: unknown[][]) {
  const cola = [...resultados];
  const registro = { donde: [] as (ReturnType<typeof render> | undefined)[], orden: [] as NonNullable<ReturnType<typeof render>>[], limite: [] as number[], consultas: 0 };
  const base = {
    select: () => {
      registro.consultas++;
      const filas = cola.shift() ?? [];
      const c: Record<string, unknown> = {};
      for (const m of ["from", "innerJoin", "leftJoin"]) c[m] = () => c;
      c.where = (d: unknown) => {
        registro.donde.push(render(d));
        return c;
      };
      c.orderBy = (...o: unknown[]) => {
        for (const x of o) registro.orden.push(render(x)!);
        return c;
      };
      c.limit = async (n: number) => {
        registro.limite.push(n);
        return filas;
      };
      c.then = (a: (v: unknown) => unknown, b: (e: unknown) => unknown) => Promise.resolve(filas).then(a, b);
      return c;
    },
  };
  return { base: base as never, registro };
}

const fila = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  concepto: "membresia_y_reserva",
  monto: 33666,
  metodo: "yape",
  estado: "pendiente",
  creadoEn: new Date("2026-11-01T15:00:00Z"),
  revisadoEn: null,
  motivoRechazo: null,
  reemplazaA: null,
  reenvioHasta: null,
  reenvioVigente: null,
  clienteId: "u1",
  clienteNombre: "María Pérez",
  clienteCorreo: "maria@correo.com",
  clienteCelular: "987654321",
  membresiaId: "m1",
  membresiaEstado: "pendiente",
  reservaId: "r1",
  reservaEstado: "pendiente",
  reservaExpiraEn: new Date("2026-11-02T15:00:00Z"),
  reservaInicio: new Date("2026-11-07T15:00:00Z"),
  reservaTipo: "profunda",
  reservaDistrito: "Miraflores",
  reservaCalle: "Av. Larco",
  reservaNumero: "123",
  reservaDepartamento: "Dpto. 302",
  reservaMonto: 6966,
  reservaPrimeraGratis: true,
  reservaHorasGratis: "3",
  ...extra,
});

async function error(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("se esperaba un error");
}

describe("listarPagos", () => {
  it("devuelve el pago, el cliente, la membresía, la reserva y la ruta del comprobante", async () => {
    const { base } = crearBase([fila()]);
    const [e] = await listarPagos(base, {}, CONFIG);
    expect(e.pago).toMatchObject({ id: ID, concepto: "membresia_y_reserva", monto: 33666, metodo: "yape", estado: "pendiente", motivo_rechazo: null, reemplaza_a: null });
    expect(e.cliente).toEqual({ id: "u1", nombre: "María Pérez", correo: "maria@correo.com", celular: "987654321" });
    expect(e.membresia).toEqual({ id: "m1", estado: "pendiente" });
    expect(e.reserva).toMatchObject({ id: "r1", estado: "pendiente", expira_en: "2026-11-02T10:00:00-05:00", inicio: "2026-11-07T10:00:00-05:00", primera_gratis: true, horas_gratis_aplicadas: 3 });
    expect(e.comprobante).toBe(`/api/comprobantes/${ID}`);
  });

  it("muestra el estado efectivo que calculó la base (una vencida llega como expirada)", async () => {
    const { base, registro } = crearBase([fila({ reservaEstado: "expirada" })]);
    const [e] = await listarPagos(base, {}, CONFIG);
    expect(e.reserva?.estado).toBe("expirada");
    expect(registro.consultas).toBe(1);
  });

  it("un pago sin reserva viva ni membresía llega con reserva y membresía null", async () => {
    const { base } = crearBase([fila({ reservaId: null, membresiaId: null, membresiaEstado: null })]);
    const [e] = await listarPagos(base, {}, CONFIG);
    expect(e.reserva).toBeNull();
    expect(e.membresia).toBeNull();
  });

  it("pide pendientes por defecto, máximo 100, y ordena por vencimiento vivo y antigüedad", async () => {
    const { base, registro } = crearBase([]);
    await listarPagos(base, {}, CONFIG);
    expect(registro.donde[0]!.params).toContain("pendiente");
    expect(registro.limite).toEqual([LIMITE_DE_LISTA]);
    expect(LIMITE_DE_LISTA).toBe(100);
    expect(registro.orden[0].sql).toMatch(/CASE WHEN "reservas"\."estado" = 'pendiente' AND "reservas"\."expira_en" > now\(\) THEN "reservas"\."expira_en" END ASC NULLS LAST/);
    expect(registro.orden[1].sql).toContain('"pagos"."creado_en" asc');
  });

  it("un rechazado trae reenvio_hasta (en hora de Lima) y reenvio_vigente", async () => {
    const { base, registro } = crearBase([fila({ estado: "rechazado", revisadoEn: new Date("2026-11-02T15:00:00Z"), motivoRechazo: "No coincide", reenvioHasta: "2026-11-09T15:00:00.000Z", reenvioVigente: true })]);
    const [e] = await listarPagos(base, { estado: "rechazado" }, CONFIG);
    expect(e.pago).toMatchObject({ estado: "rechazado", motivo_rechazo: "No coincide", reenvio_hasta: "2026-11-09T10:00:00-05:00", reenvio_vigente: true });
    expect(registro.donde[0]!.params).toContain("rechazado");
    expect(registro.orden[0].sql).toContain("DESC NULLS LAST");
  });

  it("en los demás estados los campos de plazo son null", async () => {
    const { base } = crearBase([fila()]);
    const [e] = await listarPagos(base, {}, CONFIG);
    expect(e.pago.reenvio_hasta).toBeNull();
    expect(e.pago.reenvio_vigente).toBeNull();
  });

  it("el plazo llega a la consulta como parámetro de configuración", async () => {
    const { base, registro } = crearBase([]);
    await listarPagos(base, { estado: "rechazado" }, { ...CONFIG, reenvio_comprobante_dias: 2 });
    expect(registro.consultas).toBe(1);
  });

  it.each(["otro", "", "PENDIENTE"])("estado %j → 422 sin consultar", async (estado) => {
    const { base, registro } = crearBase([]);
    expect(await error(listarPagos(base, { estado }, CONFIG))).toMatchObject({ status: 422, message: expect.stringMatching(/pendiente, aprobado o rechazado/) });
    expect(registro.consultas).toBe(0);
  });
});

describe("detalleDePago", () => {
  const revisada = { usuarioId: "u1", distrito: "Miraflores", direccionNormalizada: "avenida larco 123", departamentoNormalizado: "dpto 302" };
  const otra = {
    cliente: "Otra Persona",
    distrito: "Miraflores",
    calle: "Larco",
    numero: "123",
    departamento: null,
    direccionNormalizada: "larco 123",
    departamentoNormalizado: "",
    estado: "confirmada",
    inicio: new Date("2026-11-09T15:00:00Z"),
  };

  it("devuelve los mismos datos más las coincidencias", async () => {
    const { base } = crearBase([fila()], [revisada], [otra]);
    const d = await detalleDePago(base, ID, CONFIG);
    expect(d.pago.id).toBe(ID);
    expect(d.coincidencias.aplica).toBe(true);
    expect(d.coincidencias.lista).toEqual([
      { nivel: "calle_parecida", cliente: "Otra Persona", distrito: "Miraflores", calle: "Larco", numero: "123", departamento: null, estado: "confirmada", inicio: "2026-11-09T10:00:00-05:00" },
    ]);
  });

  it("sin reserva gratis: aplica falso y lista vacía", async () => {
    const { base } = crearBase([fila()], []);
    const d = await detalleDePago(base, ID, CONFIG);
    expect(d.coincidencias).toEqual({ aplica: false, lista: [] });
  });

  it("un pago sin membresía no busca coincidencias", async () => {
    const { base, registro } = crearBase([fila({ membresiaId: null, membresiaEstado: null })]);
    const d = await detalleDePago(base, ID, CONFIG);
    expect(d.coincidencias.aplica).toBe(false);
    expect(registro.consultas).toBe(1);
  });

  it("un id sin formato de uuid → 404 sin consultar", async () => {
    const { base, registro } = crearBase();
    expect(await error(detalleDePago(base, "abc", CONFIG))).toMatchObject({ status: 404 });
    expect(registro.consultas).toBe(0);
  });

  it("un uuid que no existe → 404", async () => {
    const { base } = crearBase([]);
    expect(await error(detalleDePago(base, ID, CONFIG))).toMatchObject({ status: 404 });
  });
});
