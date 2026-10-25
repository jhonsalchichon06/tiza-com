import { describe, expect, it } from "vitest";
import { construirAvisos, TEXTO_EN_REVISION, TEXTO_NUEVO_HORARIO, TEXTO_PLAZO_VENCIDO } from "./avisos";
import type { MembresiaDelPerfil, PagoReenviable } from "./membresia";

const ZONA = "America/Lima";
const AHORA = new Date("2026-10-22T15:00:00Z");
const hasta = (dias: number) => new Date(AHORA.getTime() + dias * 86_400_000);
const rechazado = (extra: Partial<PagoReenviable> = {}): PagoReenviable => ({ pagoId: "p1", reenvioHasta: hasta(4), motivoRechazo: null, ...extra });

const construir = (extra: Partial<Parameters<typeof construirAvisos>[0]> = {}) =>
  construirAvisos({
    membresia: { estado: "sin_membresia", plazo_vencido: false },
    rechazados: [],
    pagosNuevoHorario: [],
    gratisConservada: false,
    config: { horas_gratis: 3 },
    zona: ZONA,
    ahora: AHORA,
    ...extra,
  });

describe("construirAvisos", () => {
  it("sin nada que decir no hay avisos", () => expect(construir()).toEqual([]));

  it("en_revision", () => {
    const avisos = construir({ membresia: { estado: "en_revision", pago_id: "p1" } });
    expect(avisos).toEqual([{ codigo: "en_revision", texto: TEXTO_EN_REVISION }]);
    expect(TEXTO_EN_REVISION).toBe("Tu pago está en revisión. Te avisaremos aquí cuando se apruebe.");
  });

  it("pago_rechazado con 4 días de plazo: 'Te quedan 4 días' y la fecha límite en hora de Lima", () => {
    const [a] = construir({ rechazados: [rechazado()] });
    expect(a.codigo).toBe("pago_rechazado");
    expect(a.texto).toBe("Tu comprobante fue rechazado. Te quedan 4 días para subir otro, hasta el 26 de octubre de 2026.");
    expect(a).toMatchObject({ dias_restantes: 4, pago_id: "p1" });
    expect(a.motivo).toBeUndefined();
  });

  it("pago_rechazado con menos de 24 horas: último día con la hora límite", () => {
    const [a] = construir({ rechazados: [rechazado({ reenvioHasta: new Date(AHORA.getTime() + 5 * 3_600_000) })] });
    expect(a.texto).toBe("Tu comprobante fue rechazado. Hoy es tu último día para subir otro comprobante, hasta las 3:00 pm.");
    expect(a.dias_restantes).toBe(1);
  });

  it("pago_rechazado muestra el motivo textual", () => {
    const [a] = construir({ rechazados: [rechazado({ motivoRechazo: "La imagen está borrosa" })] });
    expect(a.motivo).toBe("La imagen está borrosa");
  });

  it("el plazo es un dato: con 2 días de plazo dice 'Te quedan 2 días'", () => {
    const [a] = construir({ rechazados: [rechazado({ reenvioHasta: hasta(2) })] });
    expect(a.texto).toContain("Te quedan 2 días para subir otro");
  });

  it("plazo_vencido enlaza al asistente y no ofrece reenviar", () => {
    const avisos = construir({ membresia: { estado: "sin_membresia", plazo_vencido: true } });
    expect(avisos).toEqual([{ codigo: "plazo_vencido", texto: TEXTO_PLAZO_VENCIDO, enlace: { texto: "Empezar de nuevo", href: "/reservar" } }]);
    expect(TEXTO_PLAZO_VENCIDO).toBe("Pasó el plazo para subir otro comprobante. Puedes empezar de nuevo con una reserva y un pago nuevos.");
  });

  it("nuevo_horario: un aviso por pago aprobado sin reserva", () => {
    const avisos = construir({ pagosNuevoHorario: [{ id: "pa" }] });
    expect(avisos).toEqual([{ codigo: "nuevo_horario", texto: TEXTO_NUEVO_HORARIO, pago_id: "pa" }]);
    expect(TEXTO_NUEVO_HORARIO).toBe("Tu pago fue aprobado. Elige un nuevo día y hora para tu limpieza, no tienes que pagar otra vez.");
  });

  it("limpieza gratis conservada con las horas de configuración", () => {
    expect(construir({ gratisConservada: true })[0].texto).toBe(
      "Tu limpieza gratis sigue disponible: tu próxima reserva llevará las 3 primeras horas sin costo.",
    );
    expect(construir({ gratisConservada: true, config: { horas_gratis: 2 } })[0].texto).toContain("las 2 primeras horas");
    expect(construir({ gratisConservada: true, config: { horas_gratis: 1 } })[0].texto).toContain("la primera hora");
  });

  it("vencida dice cuándo venció", () => {
    const membresia: MembresiaDelPerfil = { estado: "vencida", fin: "2026-10-01T10:00:00-05:00" };
    expect(construir({ membresia })).toEqual([{ codigo: "vencida", texto: "Tu membresía venció el 1 de octubre de 2026." }]);
  });
});
