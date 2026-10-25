import { describe, expect, it } from "vitest";
import { crearBdDoble } from "./__dobles__/bd-doble";
import { limpiezaGratisConservada } from "./gratis-conservada";
import type { MembresiaDelPerfil } from "./membresia";

const ACTIVA: MembresiaDelPerfil = { estado: "activa", inicio: "2026-10-01T10:00:00-05:00", fin: "2026-12-30T10:00:00-05:00", dias_restantes: 60 };
const CANCELADA = { distrito: "Miraflores", direccionNormalizada: "avenida larco 123", departamentoNormalizado: "" };

// Tres lecturas: la reserva cancelada con primera_gratis, la decisión por cliente y la decisión por hogar
// (una fila = hay una reserva que cuenta = la regla da falso).
async function correr({ membresia = ACTIVA, cancelada = [CANCELADA] as unknown[], otraDelCliente = false, hogarUsado = false } = {}) {
  const doble = crearBdDoble({ reservas: [cancelada, otraDelCliente ? [{ id: "r2" }] : [], hogarUsado ? [{ id: "r3" }] : []] });
  const r = await limpiezaGratisConservada(doble.base, "u1", membresia);
  return { r, doble };
}

describe("limpiezaGratisConservada", () => {
  it("cancelada sin otra reserva: verdadero", async () => {
    expect((await correr()).r).toBe(true);
  });

  it("con una reserva completada o confirmada del cliente: falso", async () => {
    expect((await correr({ otraDelCliente: true })).r).toBe(false);
  });

  it("el hogar ya usado por otra cuenta: falso", async () => {
    expect((await correr({ hogarUsado: true })).r).toBe(false);
  });

  it("sin reserva cancelada con primera_gratis: falso", async () => {
    expect((await correr({ cancelada: [] })).r).toBe(false);
  });

  it.each<[string, MembresiaDelPerfil]>([
    ["pendiente (en revisión)", { estado: "en_revision", pago_id: "p" }],
    ["vencida", { estado: "vencida", fin: "2026-01-01T10:00:00-05:00" }],
    ["sin membresía", { estado: "sin_membresia", plazo_vencido: false }],
  ])("membresía %s: falso y sin consultar", async (_n, membresia) => {
    const { r, doble } = await correr({ membresia });
    expect(r).toBe(false);
    expect(doble.lecturas()).toHaveLength(0);
  });

  it("no escribe nada y filtra por usuario_id", async () => {
    const { doble } = await correr();
    expect(doble.escrituras()).toEqual([]);
    expect(doble.lecturas()[0].donde?.params).toContain("u1");
  });

  it("decide con la clave del hogar de la reserva cancelada", async () => {
    const { doble } = await correr();
    const porHogar = doble.lecturas()[2];
    expect(porHogar.donde?.params).toEqual(expect.arrayContaining(["Miraflores", "avenida larco 123"]));
  });
});
