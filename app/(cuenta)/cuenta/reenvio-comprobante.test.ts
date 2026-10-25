import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AVISO_DEMOSTRACION } from "@/lib/aviso-demo";
import { construirAvisos } from "@/lib/perfil/avisos";
import type { PagoReenviable } from "@/lib/perfil/membresia";
import { CCI_TIZA, RUTA_QR_YAPE, TITULAR_TIZA } from "@/lib/reservas/datos-de-pago";
import { Avisos } from "./Avisos";
import { TEXTO_SIN_RESERVA_VIVA, VistaReenvio } from "./ReenviarComprobante";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const ZONA = "America/Lima";
const AHORA = new Date("2026-11-02T15:00:00Z");
const rechazado = (dias: number, extra: Partial<PagoReenviable> = {}): PagoReenviable => ({
  pagoId: "pago-1",
  reenvioHasta: new Date(AHORA.getTime() + dias * 86_400_000),
  motivoRechazo: null,
  ...extra,
});
const avisosDe = (parcial: Partial<Parameters<typeof construirAvisos>[0]>) =>
  construirAvisos({
    membresia: { estado: "sin_membresia", plazo_vencido: false },
    rechazados: [],
    pagosNuevoHorario: [],
    gratisConservada: false,
    config: { horas_gratis: 3 },
    zona: ZONA,
    ahora: AHORA,
    ...parcial,
  });
const html = (avisos: ReturnType<typeof avisosDe>) => renderToStaticMarkup(createElement(Avisos, { avisos, usuarioId: "u1", zona: ZONA }));

describe("Avisos: formulario de reenvío", () => {
  it("con el plazo vigente aparece el formulario con el motivo, los días restantes y la fecha límite", () => {
    const salida = html(avisosDe({ rechazados: [rechazado(4, { motivoRechazo: "La imagen está borrosa" })] }));
    expect(salida).toContain("Te quedan 4 días para subir otro, hasta el 6 de noviembre de 2026.");
    expect(salida).toContain("Motivo: La imagen está borrosa");
    expect(salida).toContain("Enviar comprobante");
    expect(salida).toContain('type="file"');
  });

  it("con el plazo vencido no hay formulario: solo el aviso de empezar de nuevo con el enlace al asistente", () => {
    const salida = html(avisosDe({ membresia: { estado: "sin_membresia", plazo_vencido: true } }));
    expect(salida).toContain("Pasó el plazo para subir otro comprobante. Puedes empezar de nuevo con una reserva y un pago nuevos.");
    expect(salida).toContain('href="/reservar"');
    expect(salida).not.toContain("Enviar comprobante");
    expect(salida).not.toContain('type="file"');
  });

  it("sin reserva viva dice que elegirá un nuevo día y hora sin pagar otra vez", () => {
    const salida = html(avisosDe({ rechazados: [rechazado(4)] }));
    expect(TEXTO_SIN_RESERVA_VIVA).toBe("Si se aprueba tu pago, elegirás un nuevo día y hora sin pagar otra vez.");
    expect(salida).toContain(TEXTO_SIN_RESERVA_VIVA);
  });

  it("con la reserva todavía pendiente muestra la hora límite de su espera y no el texto de nuevo día", () => {
    const salida = html(avisosDe({ rechazados: [rechazado(4)], reservaEnEsperaHasta: "2026-11-03T10:00:00-05:00" }));
    expect(salida).toContain("conserva su horario hasta el martes 3 de noviembre, 10:00 am");
    expect(salida).not.toContain(TEXTO_SIN_RESERVA_VIVA);
  });

  it("el último día muestra la hora límite", () => {
    const salida = html(avisosDe({ rechazados: [{ ...rechazado(0), reenvioHasta: new Date(AHORA.getTime() + 5 * 3_600_000) }] }));
    expect(salida).toContain("Hoy es tu último día para subir otro comprobante, hasta las 3:00 pm.");
  });
});

describe("VistaReenvio", () => {
  const base = { metodo: null, enviando: false, mensaje: null, estado: { tipo: "formulario" as const }, esperaHasta: null, onMetodo() {}, onArchivo() {}, onEnviar() {} };
  const vista = (extra: Partial<Parameters<typeof VistaReenvio>[0]> = {}) => renderToStaticMarkup(createElement(VistaReenvio, { ...base, ...extra }));

  it("muestra el aviso de demostración junto a los datos de pago (QR o CCI)", () => {
    const yape = vista({ metodo: "yape" });
    expect(yape).toContain(AVISO_DEMOSTRACION);
    expect(yape).toContain(RUTA_QR_YAPE);
    expect(yape).toContain(TITULAR_TIZA);
    const transferencia = vista({ metodo: "transferencia" });
    expect(transferencia).toContain(AVISO_DEMOSTRACION);
    expect(transferencia).toContain(CCI_TIZA);
  });

  it("el botón se deshabilita durante el envío", () => {
    expect(vista({ enviando: true })).toMatch(/<button[^>]*disabled[^>]*>Enviando\.\.\.<\/button>/);
    expect(vista()).not.toMatch(/<button[^>]*disabled/);
  });

  it("acepta solo JPG, PNG o WebP e informa el límite de 5 MB", () => {
    const salida = vista();
    expect(salida).toContain("image/jpeg,image/png,image/webp");
    expect(salida).toContain("hasta 5 MB");
  });

  it("plazo vencido al enviar: reemplaza el formulario por el aviso de empezar de nuevo", () => {
    const salida = vista({ estado: { tipo: "plazo_vencido", mensaje: "Pasó el plazo para subir otro comprobante. Puedes empezar de nuevo con una reserva y un pago nuevos." } });
    expect(salida).toContain("Pasó el plazo");
    expect(salida).toContain('href="/reservar"');
    expect(salida).not.toContain('type="file"');
  });

  it("muestra el mensaje del servidor y, al terminar, el aviso de que el comprobante está en revisión", () => {
    expect(vista({ mensaje: "Ya tienes un comprobante en revisión." })).toContain("Ya tienes un comprobante en revisión.");
    expect(vista({ estado: { tipo: "enviado" } })).toContain("Recibimos tu comprobante");
  });
});
