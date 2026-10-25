import { describe, expect, it } from "vitest";
import { pagosConHorarioPendiente } from "./horario-pendiente";
import { render } from "./__dobles__/tx-doble";

function crearBase(filas: unknown[]) {
  const registro: { donde?: ReturnType<typeof render> } = {};
  const c: Record<string, unknown> = {};
  c.from = () => c;
  c.where = (d: unknown) => {
    registro.donde = render(d);
    return c;
  };
  c.orderBy = async () => filas;
  return { base: { select: () => c } as never, registro };
}

describe("pagosConHorarioPendiente", () => {
  it("devuelve lo que la base encuentra", async () => {
    const fila = { id: "p1", usuarioId: "u1", membresiaId: "m1", concepto: "membresia_y_reserva", monto: 33666, revisadoEn: new Date() };
    const { base } = crearBase([fila]);
    expect(await pagosConHorarioPendiente(base)).toEqual([fila]);
  });

  it("pide pagos aprobados sin ninguna reserva activa, confirmada ni completada", async () => {
    const { base, registro } = crearBase([]);
    await pagosConHorarioPendiente(base);
    const q = registro.donde!;
    expect(q.sql).toContain('"pagos"."estado" = $');
    expect(q.params).toContain("aprobado");
    expect(q.sql).toMatch(/NOT EXISTS \(SELECT 1 FROM "reservas" WHERE "reservas"\."pago_id" = "pagos"\."id"/);
    expect(q.sql).toContain("now()"); // la pendiente vencida no cuenta como viva
    expect(q.params).toEqual(expect.arrayContaining(["confirmada", "pendiente", "completada"]));
    expect(q.params).not.toContain("expirada");
    expect(q.params).not.toContain("cancelada");
  });

  it("excluye el pago de solo membresía que nunca tuvo reserva (una renovación no deja horario por elegir)", async () => {
    const { base, registro } = crearBase([]);
    await pagosConHorarioPendiente(base);
    expect(registro.donde!.sql).toContain(
      `NOT ("pagos"."concepto" = 'membresia' AND NOT EXISTS (SELECT 1 FROM "reservas" WHERE "reservas"."pago_id" = "pagos"."id"))`,
    );
  });

  it("con usuarioId filtra por cliente; sin él, no", async () => {
    const con = crearBase([]);
    await pagosConHorarioPendiente(con.base, "u9");
    expect(con.registro.donde!.params).toContain("u9");
    const sin = crearBase([]);
    await pagosConHorarioPendiente(sin.base);
    expect(sin.registro.donde!.params).not.toContain("u9");
  });
});
