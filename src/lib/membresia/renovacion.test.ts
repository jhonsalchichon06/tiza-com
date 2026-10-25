import { describe, expect, it } from "vitest";
import type { FilaMembresia, PagoReenviable } from "../perfil/membresia";
import { estadoDeRenovacion, puedeElegirDiaYHora, sinRenovacionesPendientes, TEXTO_RENOVACION_EN_REVISION } from "./renovacion";

const ZONA = "America/Lima";
const AHORA = new Date("2026-12-10T15:00:00Z");
const PLAN = { meses: 3, monto: 26700 };
const DIA = 86_400;

const activa = (diasRestantes: number, extra: Partial<FilaMembresia> = {}): FilaMembresia => ({
  id: "m-activa",
  estado: "activa",
  inicio: new Date("2026-09-10T15:00:00Z"),
  fin: new Date(AHORA.getTime() + diasRestantes * DIA * 1000),
  vigente: diasRestantes > 0,
  segundosRestantes: diasRestantes * DIA,
  ultimoPago: { id: "p0", estado: "aprobado" },
  ...extra,
});
const pendiente = (estadoPago: "pendiente" | "rechazado" | null, id = "p1"): FilaMembresia => ({
  id: "m-pend",
  estado: "pendiente",
  inicio: null,
  fin: null,
  vigente: false,
  segundosRestantes: null,
  ultimoPago: estadoPago ? { id, estado: estadoPago } : null,
});
const caducada: FilaMembresia = { ...pendiente(null), id: "m-cad", estado: "caducada" };
const reenviable = (dias: number, motivo: string | null = null, pagoId = "p1"): PagoReenviable => ({
  pagoId,
  reenvioHasta: new Date(AHORA.getTime() + dias * DIA * 1000),
  motivoRechazo: motivo,
});

const calcular = (membresias: FilaMembresia[], extra: { pagosReenviables?: PagoReenviable[]; avisoDias?: number } = {}) =>
  estadoDeRenovacion({ membresias, pagosReenviables: extra.pagosReenviables ?? [], avisoDias: extra.avisoDias ?? 14, zona: ZONA, plan: PLAN, ahora: AHORA });

describe("estadoDeRenovacion", () => {
  it("sin membresías: no_aplica", () => expect(calcular([])).toEqual({ estado: "no_aplica" }));

  it("vigente con 60 días y ventana de 14: no_aplica", () => expect(calcular([activa(60)]).estado).toBe("no_aplica"));

  it("faltan 10 días: por_vencer con fin, días restantes y el texto con la fecha en hora de Lima", () => {
    const r = calcular([activa(10)]);
    expect(r).toMatchObject({ estado: "por_vencer", dias_restantes: 10 });
    if (r.estado !== "por_vencer") throw new Error("estado");
    expect(r.fin).toBe("2026-12-20T10:00:00-05:00");
    expect(r.texto).toContain("Tu membresía vence el 20 de diciembre de 2026.");
    expect(r.texto).toContain("No podrás agendar limpiezas para después de esa fecha.");
    expect(r.texto).toContain("deberás realizar un nuevo pago para seguir reservando");
  });

  it("límite: exactamente renovacion_aviso_dias días es por_vencer; un segundo más es no_aplica", () => {
    expect(calcular([activa(14)]).estado).toBe("por_vencer");
    expect(calcular([activa(14, { segundosRestantes: 14 * DIA + 1 })]).estado).toBe("no_aplica");
  });

  it("redondea hacia arriba los días restantes (medio día cuenta 1)", () => {
    expect(calcular([activa(1, { segundosRestantes: DIA / 2 })])).toMatchObject({ estado: "por_vencer", dias_restantes: 1 });
    expect(calcular([activa(3, { segundosRestantes: 2 * DIA + 1 })])).toMatchObject({ dias_restantes: 3 });
  });

  it("la ventana es un dato: con 7 días y 10 restantes es no_aplica", () => {
    expect(calcular([activa(10)], { avisoDias: 7 }).estado).toBe("no_aplica");
    expect(calcular([activa(10)], { avisoDias: 10 }).estado).toBe("por_vencer");
  });

  it("fin igual a ahora: ya no es vigente, es vencida", () => {
    expect(calcular([activa(0, { fin: AHORA, vigente: false, segundosRestantes: 0 })]).estado).toBe("vencida");
  });

  it("vencida: texto del mes 4 con la fecha y el plan leído (3 meses: S/ 267)", () => {
    const r = calcular([activa(-2)]);
    expect(r).toMatchObject({ estado: "vencida", plan: PLAN });
    if (r.estado !== "vencida") throw new Error("estado");
    expect(r.texto).toContain("Tu membresía venció el 8 de diciembre de 2026.");
    expect(r.texto).toContain("Realiza un nuevo pago para que tu servicio del mes 4 sea válido.");
    expect(r.texto).toContain("Renovar por 3 meses: S/ 267");
  });

  it("el plan del texto sigue al plan recibido, no a una constante", () => {
    const r = estadoDeRenovacion({ membresias: [activa(-2)], pagosReenviables: [], avisoDias: 14, zona: ZONA, plan: { meses: 1, monto: 8900 }, ahora: AHORA });
    expect(r.estado === "vencida" && r.texto).toContain("Renovar por 1 mes: S/ 89");
  });

  it("vencida y con una pendiente cuyo pago está pendiente: renovacion_en_revision con su texto", () => {
    const r = calcular([activa(-2), pendiente("pendiente")]);
    expect(r).toEqual({ estado: "renovacion_en_revision", pago_id: "p1", texto: TEXTO_RENOVACION_EN_REVISION });
  });

  it("pago rechazado dentro del plazo: renovacion_rechazada con motivo, días y fecha límite", () => {
    const r = calcular([activa(-2), pendiente("rechazado")], { pagosReenviables: [reenviable(4, "Borroso")] });
    expect(r).toMatchObject({ estado: "renovacion_rechazada", pago_id: "p1", motivo_rechazo: "Borroso", dias_restantes: 4 });
    if (r.estado !== "renovacion_rechazada") throw new Error("estado");
    expect(r.texto).toContain("Sube otro comprobante antes del 14 de diciembre de 2026.");
  });

  it("plazo de reenvío vencido (no reenviable aunque el cierre no corrió): vuelve a vencida", () => {
    expect(calcular([activa(-2), pendiente("rechazado")]).estado).toBe("vencida");
  });

  it("una caducada no cuenta: la renovación cerrada deja al cliente en vencida", () => {
    expect(calcular([activa(-2), caducada]).estado).toBe("vencida");
  });

  it("una caducada sola no genera aviso de renovación", () => expect(calcular([caducada]).estado).toBe("no_aplica"));

  it("la primera membresía en revisión es no_aplica", () => {
    expect(calcular([pendiente("pendiente")]).estado).toBe("no_aplica");
    expect(calcular([pendiente("rechazado")], { pagosReenviables: [reenviable(3)] }).estado).toBe("no_aplica");
  });

  it("con dos activas cuenta la de fin más lejano", () => {
    expect(calcular([activa(-30, { id: "vieja" }), activa(60, { id: "nueva" })]).estado).toBe("no_aplica");
    expect(calcular([activa(-30, { id: "vieja" }), activa(5, { id: "nueva" })]).estado).toBe("por_vencer");
  });
});

describe("sinRenovacionesPendientes", () => {
  it("con una activa quita las pendientes (son renovaciones)", () => {
    expect(sinRenovacionesPendientes([activa(-2), pendiente("pendiente")]).map((m) => m.estado)).toEqual(["activa"]);
  });

  it("sin activa conserva la pendiente: es la primera membresía", () => {
    expect(sinRenovacionesPendientes([pendiente("pendiente")]).map((m) => m.estado)).toEqual(["pendiente"]);
  });
});

describe("puedeElegirDiaYHora", () => {
  const activaPerfil = { estado: "activa" as const, inicio: "", fin: "", dias_restantes: 30 };
  it("con membresía activa y no_aplica o por_vencer: sí", () => {
    expect(puedeElegirDiaYHora(activaPerfil, { estado: "no_aplica" })).toBe(true);
    expect(puedeElegirDiaYHora(activaPerfil, calcular([activa(5)]))).toBe(true);
  });

  it("vencida, en revisión o rechazada: no", () => {
    const vencida = { estado: "vencida" as const, fin: "" };
    expect(puedeElegirDiaYHora(vencida, calcular([activa(-1)]))).toBe(false);
    expect(puedeElegirDiaYHora(vencida, calcular([activa(-1), pendiente("pendiente")]))).toBe(false);
    expect(puedeElegirDiaYHora(vencida, calcular([activa(-1), pendiente("rechazado")], { pagosReenviables: [reenviable(2)] }))).toBe(false);
  });

  it("sin membresía: no", () => {
    expect(puedeElegirDiaYHora({ estado: "sin_membresia", plazo_vencido: false }, { estado: "no_aplica" })).toBe(false);
  });
});
