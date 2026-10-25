import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { render } from "./__dobles__/tx-doble";
import { pagosRechazadosReenviables } from "./reenvio-plazo";

// Doble de `select`: devuelve las filas dadas y registra la condición y el orden pedidos.
function crearBase(filas: unknown[]) {
  const registro: { donde?: ReturnType<typeof render> } = {};
  const c: Record<string, unknown> = {};
  c.from = () => c;
  c.leftJoin = () => c;
  c.where = (d: unknown) => {
    registro.donde = render(d);
    return c;
  };
  c.orderBy = async () => filas;
  return { base: { select: () => c } as never, registro };
}

const fila = (extra: Record<string, unknown> = {}) => ({
  pagoId: "p1",
  membresiaId: "m1",
  reenvioHasta: "2026-11-09T15:00:00.000Z",
  motivoRechazo: "Borroso",
  ...extra,
});

describe("pagosRechazadosReenviables", () => {
  it("devuelve el pago, la membresía, el fin del plazo y el motivo", async () => {
    const { base } = crearBase([fila()]);
    expect(await pagosRechazadosReenviables(base, "u1", VALORES_DEL_DISENO)).toEqual([fila()]);
  });

  it("sin pagos que cumplan la condición devuelve una lista vacía", async () => {
    const { base } = crearBase([]);
    expect(await pagosRechazadosReenviables(base, "u1", VALORES_DEL_DISENO)).toEqual([]);
  });

  it("pide solo los del cliente, rechazados, con el plazo vigente según la base, sin reemplazo y sin membresía caducada", async () => {
    const { base, registro } = crearBase([]);
    await pagosRechazadosReenviables(base, "u1", VALORES_DEL_DISENO);
    const q = registro.donde!;
    expect(q.params).toEqual(expect.arrayContaining(["u1", "rechazado"]));
    expect(q.sql).toContain("make_interval(days =>");
    expect(q.sql).toContain("> now()"); // el reloj es el de la base
    expect(q.sql).toMatch(/NOT EXISTS \(SELECT 1 FROM pagos r WHERE r\.reemplaza_a = "pagos"\."id"\)/);
    expect(q.sql).toMatch(/"membresias"\."estado" <> 'caducada'/);
  });

  it.each([7, 2, 30])("el plazo sale de configuración: %i días llegan como parámetro", async (dias) => {
    const { base, registro } = crearBase([]);
    await pagosRechazadosReenviables(base, "u1", { ...VALORES_DEL_DISENO, reenvio_comprobante_dias: dias });
    expect(registro.donde!.params).toContain(dias);
  });

  it("descarta una fila sin fecha límite (no debería ocurrir con un pago rechazado)", async () => {
    const { base } = crearBase([fila({ reenvioHasta: null })]);
    expect(await pagosRechazadosReenviables(base, "u1", VALORES_DEL_DISENO)).toEqual([]);
  });
});
