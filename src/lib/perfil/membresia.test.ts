import { describe, expect, it } from "vitest";
import { crearBdDoble } from "./__dobles__/bd-doble";
import { estadoDeMembresia, leerMembresiaDelCliente, type FilaMembresia, type PagoReenviable } from "./membresia";

const ZONA = "America/Lima";
const DIA = 86_400;

const fila = (extra: Partial<FilaMembresia> = {}): FilaMembresia => ({
  id: "m1",
  estado: "pendiente",
  inicio: null,
  fin: null,
  vigente: false,
  segundosRestantes: null,
  ultimoPago: null,
  ...extra,
});
const activa = (dias: number, extra: Partial<FilaMembresia> = {}) =>
  fila({
    id: "ma",
    estado: "activa",
    inicio: new Date("2026-10-01T15:00:00Z"),
    fin: new Date("2026-12-01T15:00:00Z"),
    vigente: dias > 0,
    segundosRestantes: dias * DIA,
    ...extra,
  });
const reenviable = (extra: Partial<PagoReenviable> = {}): PagoReenviable => ({
  pagoId: "p1",
  reenvioHasta: new Date("2026-10-25T15:00:00Z"),
  motivoRechazo: null,
  ...extra,
});
const estado = (membresias: FilaMembresia[], pagosReenviables: PagoReenviable[] = []) =>
  estadoDeMembresia({ membresias, pagosReenviables, zona: ZONA });

describe("estadoDeMembresia", () => {
  it("sin membresías: sin_membresia y sin aviso de plazo", () => {
    expect(estado([])).toEqual({ estado: "sin_membresia", plazo_vencido: false });
  });

  it("pendiente con pago pendiente: en_revision", () => {
    expect(estado([fila({ ultimoPago: { id: "p1", estado: "pendiente" } })])).toEqual({ estado: "en_revision", pago_id: "p1" });
  });

  it("pendiente con pago rechazado dentro del plazo: pago_rechazado con el motivo y el límite en hora de Lima", () => {
    const r = estado([fila({ ultimoPago: { id: "p1", estado: "rechazado" } })], [reenviable({ motivoRechazo: "Borroso" })]);
    expect(r).toEqual({ estado: "pago_rechazado", pago_id: "p1", motivo_rechazo: "Borroso", reenvio_hasta: "2026-10-25T10:00:00-05:00" });
  });

  it("pendiente con pago rechazado fuera del plazo (cierre sin correr): plazo vencido", () => {
    expect(estado([fila({ ultimoPago: { id: "p1", estado: "rechazado" } })], [])).toEqual({ estado: "sin_membresia", plazo_vencido: true });
  });

  it("un rechazado reenviable de otro pago no habilita este", () => {
    const r = estado([fila({ ultimoPago: { id: "p1", estado: "rechazado" } })], [reenviable({ pagoId: "otro" })]);
    expect(r).toEqual({ estado: "sin_membresia", plazo_vencido: true });
  });

  it("activa con fin dentro de 40 días: dias_restantes 40, inicio y fin con desfase de Lima", () => {
    expect(estado([activa(40)])).toEqual({
      estado: "activa",
      inicio: "2026-10-01T10:00:00-05:00",
      fin: "2026-12-01T10:00:00-05:00",
      dias_restantes: 40,
    });
  });

  it("activa con 0,2 días: dias_restantes 1 (hacia arriba)", () => {
    expect(estado([activa(0.2)])).toMatchObject({ estado: "activa", dias_restantes: 1 });
  });

  it("activa con fin pasado: vencida con la fecha de fin", () => {
    expect(estado([activa(-3)])).toEqual({ estado: "vencida", fin: "2026-12-01T10:00:00-05:00" });
  });

  it("solo caducada: sin_membresia con aviso de empezar de nuevo", () => {
    expect(estado([fila({ estado: "caducada" })])).toEqual({ estado: "sin_membresia", plazo_vencido: true });
  });

  it("una activa vigente gana a una pendiente", () => {
    const r = estado([fila({ ultimoPago: { id: "p9", estado: "pendiente" } }), activa(10)]);
    expect(r.estado).toBe("activa");
  });

  it("una pendiente gana a una activa vencida", () => {
    const r = estado([activa(-3), fila({ ultimoPago: { id: "p9", estado: "pendiente" } })]);
    expect(r.estado).toBe("en_revision");
  });

  it("el inicio sale de la fila (aprobación), no de la creación del pago", () => {
    const m = activa(60, { inicio: new Date("2026-10-21T14:00:00Z") });
    expect(estado([m])).toMatchObject({ inicio: "2026-10-21T09:00:00-05:00" });
  });
});

describe("leerMembresiaDelCliente", () => {
  it("filtra membresías y pagos por usuario_id y combina el último pago de cada membresía", async () => {
    const doble = crearBdDoble({
      membresias: [[{ id: "m1", estado: "pendiente", inicio: null, fin: null, vigente: false, segundosRestantes: null }]],
      pagos: [[{ id: "p2", membresiaId: "m1", estado: "pendiente" }, { id: "p1", membresiaId: "m1", estado: "rechazado" }]],
    });
    const filas = await leerMembresiaDelCliente(doble.base, "usuario-A");
    expect(filas).toEqual([
      { id: "m1", estado: "pendiente", inicio: null, fin: null, vigente: false, segundosRestantes: null, ultimoPago: { id: "p2", estado: "pendiente" } },
    ]);
    const lecturas = doble.lecturas();
    expect(lecturas).toHaveLength(2);
    for (const l of lecturas) {
      expect(l.donde?.sql).toContain('"usuario_id" = $');
      expect(l.donde?.params).toContain("usuario-A");
    }
  });

  it("sin membresías no consulta los pagos", async () => {
    const doble = crearBdDoble({ membresias: [[]] });
    expect(await leerMembresiaDelCliente(doble.base, "usuario-A")).toEqual([]);
    expect(doble.lecturas()).toHaveLength(1);
  });

  it("convierte los segundos restantes que devuelve la base como texto", async () => {
    const doble = crearBdDoble({
      membresias: [[{ id: "m1", estado: "activa", inicio: new Date(), fin: new Date(), vigente: true, segundosRestantes: "3456000.5" }]],
      pagos: [[]],
    });
    const [m] = await leerMembresiaDelCliente(doble.base, "u");
    expect(m.segundosRestantes).toBe(3456000.5);
    expect(m.ultimoPago).toBeNull();
  });
});
