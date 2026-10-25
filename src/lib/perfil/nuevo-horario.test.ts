import { describe, expect, it } from "vitest";
import type { PagoConHorarioPendiente } from "../pagos/horario-pendiente";
import { crearBdDoble } from "./__dobles__/bd-doble";
import { pagosParaElegirHorario } from "./nuevo-horario";

const pago = (id: string): PagoConHorarioPendiente => ({ id, usuarioId: "u1", membresiaId: "m1", concepto: "reserva", monto: 12900, revisadoEn: new Date() });

async function correr(pagos: PagoConHorarioPendiente[], reservas: { pagoId: string; estado: string; canceladaPor: string | null }[]) {
  const doble = crearBdDoble({ reservas: [reservas] });
  const r = await pagosParaElegirHorario(doble.base, "u1", async () => pagos);
  return { r, doble };
}

describe("pagosParaElegirHorario", () => {
  it("reserva expirada: el pago aparece", async () => {
    const { r } = await correr([pago("p1")], [{ pagoId: "p1", estado: "expirada", canceladaPor: null }]);
    expect(r.map((p) => p.id)).toEqual(["p1"]);
  });

  it("cancelada por el administrador: el pago aparece", async () => {
    const { r } = await correr([pago("p1")], [{ pagoId: "p1", estado: "cancelada", canceladaPor: "admin" }]);
    expect(r.map((p) => p.id)).toEqual(["p1"]);
  });

  it("cancelada por el cliente: el pago se excluye (va a crédito, ítem 14)", async () => {
    const { r } = await correr([pago("p1")], [{ pagoId: "p1", estado: "cancelada", canceladaPor: "cliente" }]);
    expect(r).toEqual([]);
  });

  it("solo cuenta la reserva más reciente del pago", async () => {
    // Orden descendente por creación: la más reciente (expirada) va primero.
    const { r } = await correr(
      [pago("p1")],
      [
        { pagoId: "p1", estado: "expirada", canceladaPor: null },
        { pagoId: "p1", estado: "cancelada", canceladaPor: "cliente" },
      ],
    );
    expect(r.map((p) => p.id)).toEqual(["p1"]);
  });

  it("pago de reenvío sin ninguna reserva: aparece", async () => {
    const { r } = await correr([pago("p1")], []);
    expect(r.map((p) => p.id)).toEqual(["p1"]);
  });

  it("una reserva confirmada ya no está en la lista de pendientes (la excluye la consulta del ítem 11)", async () => {
    const { r, doble } = await correr([], []);
    expect(r).toEqual([]);
    expect(doble.lecturas()).toHaveLength(0);
  });

  it("filtra las reservas por usuario_id", async () => {
    const { doble } = await correr([pago("p1")], []);
    const [lectura] = doble.lecturas();
    expect(lectura.donde?.sql).toContain('"usuario_id" = $');
    expect(lectura.donde?.params).toContain("u1");
  });
});
