import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "@/lib/__fixtures__/configuracion";
import { AVISO_DEMOSTRACION } from "@/lib/aviso-demo";
import { pantallaDeRenovar } from "@/lib/membresia/pantalla-renovar";
import { planDeRenovacion } from "@/lib/membresia/plan";
import type { Renovacion } from "@/lib/membresia/renovacion";
import { CCI_TIZA, RUTA_QR_YAPE } from "@/lib/reservas/datos-de-pago";
import { AvisoRenovacion } from "../AvisoRenovacion";
import { PerfilVista } from "../PerfilVista";
import { VistaRenovacion } from "./FormularioRenovacion";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const ZONA = "America/Lima";
const PLAN = planDeRenovacion(VALORES_DEL_DISENO);
const vencida: Renovacion = { estado: "vencida", fin: "2026-12-08T10:00:00-05:00", plan: PLAN, texto: "Tu membresía venció el 8 de diciembre de 2026. Realiza un nuevo pago para que tu servicio del mes 4 sea válido. Renovar por 3 meses: S/ 267." };

const pantalla = pantallaDeRenovar(vencida);
const props = { monto: "S/ 267", duracion: "3 meses", metodo: null, enviando: false, mensaje: null, enviado: false, onMetodo: () => {}, onArchivo: () => {}, onEnviar: () => {} } as const;
const vista = (extra: Partial<Parameters<typeof VistaRenovacion>[0]> = {}) => renderToStaticMarkup(createElement(VistaRenovacion, { ...props, ...extra }));

describe("pantallaDeRenovar", () => {
  it("el cliente vencido ve el formulario con el monto y la duración del plan (S/ 267, 3 meses)", () => {
    expect(pantalla).toEqual({ tipo: "formulario", monto: "S/ 267", duracion: "3 meses" });
  });

  it("el monto sigue al plan leído: 1 mes a S/ 89", () => {
    expect(pantallaDeRenovar({ ...vencida, plan: { meses: 1, monto: 8900 } })).toEqual({ tipo: "formulario", monto: "S/ 89", duracion: "1 mes" });
  });

  it.each<[string, Renovacion]>([
    ["vigente", { estado: "no_aplica" }],
    ["por vencer", { estado: "por_vencer", fin: "x", dias_restantes: 3, texto: "t" }],
    ["en revisión", { estado: "renovacion_en_revision", pago_id: "p1", texto: "t" }],
    ["rechazada", { estado: "renovacion_rechazada", pago_id: "p1", motivo_rechazo: null, reenvio_hasta: "x", dias_restantes: 2, texto: "t" }],
  ])("%s: redirige al perfil", (_n, renovacion) => {
    expect(pantallaDeRenovar(renovacion)).toEqual({ tipo: "redirigir", a: "/cuenta" });
  });
});

describe("VistaRenovacion", () => {
  it("muestra el monto del servidor, el aviso de demostración y el campo del comprobante", () => {
    const salida = vista();
    expect(salida).toContain("Renovar mi membresía por 3 meses");
    expect(salida).toContain("S/ 267");
    expect(salida).toContain(AVISO_DEMOSTRACION);
    expect(salida).toContain('type="file"');
    expect(salida).toContain("JPG, PNG o WebP, de hasta 5 MB");
  });

  it("con Yape ve el QR y el aviso de demostración junto a él", () => {
    const salida = vista({ metodo: "yape" });
    expect(salida).toContain(RUTA_QR_YAPE);
    expect(salida).toContain(AVISO_DEMOSTRACION);
    expect(salida).not.toContain(CCI_TIZA);
  });

  it("con transferencia ve la CCI y el aviso de demostración junto a ella", () => {
    const salida = vista({ metodo: "transferencia" });
    expect(salida).toContain(CCI_TIZA);
    expect(salida).toContain(AVISO_DEMOSTRACION);
    expect(salida).not.toContain(RUTA_QR_YAPE);
  });

  it("un archivo inválido muestra el mensaje claro", () => {
    expect(vista({ mensaje: "La imagen debe ser JPG, PNG o WebP." })).toContain("La imagen debe ser JPG, PNG o WebP.");
  });

  it("enviado: confirma la revisión y no repite el formulario", () => {
    const salida = vista({ enviado: true });
    expect(salida).toContain("Recibimos tu comprobante");
    expect(salida).not.toContain('type="file"');
  });
});

describe("estilos: público de 30 a 70 años", () => {
  const css = readFileSync(new URL("./renovar.module.css", import.meta.url), "utf8");
  it("letra base de 18 px o más y botones de 48 px o más", () => {
    expect(css).toMatch(/\.pagina \{[^}]*font-size: 1\.125rem/);
    expect(css).toMatch(/\.boton \{[^}]*min-height: 3rem/);
  });

  it("el perfil, donde van el aviso y el botón Renovar, mantiene la letra de 18 px y los botones de 48 px", () => {
    const perfilCss = readFileSync(new URL("../cuenta.module.css", import.meta.url), "utf8");
    expect(perfilCss).toMatch(/\.pagina \{[^}]*font-size: 1\.125rem/);
    expect(perfilCss).toMatch(/\.boton \{[^}]*min-height: 3rem/);
  });
});

describe("AvisoRenovacion", () => {
  const html = (renovacion: Renovacion) => renderToStaticMarkup(createElement(AvisoRenovacion, { renovacion }));

  it("vencida: texto del mes 4 con el plan y el botón Renovar mi membresía hacia /cuenta/renovar", () => {
    const salida = html(vencida);
    expect(salida).toContain("Realiza un nuevo pago para que tu servicio del mes 4 sea válido.");
    expect(salida).toContain("Renovar por 3 meses: S/ 267");
    expect(salida).toContain('href="/cuenta/renovar"');
    expect(salida).toContain("Renovar mi membresía");
  });

  it("por vencer: solo el aviso, sin botón de pago", () => {
    const salida = html({ estado: "por_vencer", fin: "2026-12-20T10:00:00-05:00", dias_restantes: 10, texto: "Tu membresía vence el 20 de diciembre de 2026. No podrás agendar limpiezas para después de esa fecha." });
    expect(salida).toContain("Tu membresía vence el 20 de diciembre de 2026");
    expect(salida).not.toContain("/cuenta/renovar");
  });

  it("en revisión: texto de espera sin botón de renovar", () => {
    const salida = html({ estado: "renovacion_en_revision", pago_id: "p1", texto: "Tu pago de renovación está en revisión. Cuando se apruebe, podrás elegir día y hora desde tu perfil." });
    expect(salida).toContain("Tu pago de renovación está en revisión");
    expect(salida).not.toContain("/cuenta/renovar");
  });

  it("no_aplica y rechazada no pintan aquí (la rechazada la muestra el aviso de reenvío)", () => {
    expect(html({ estado: "no_aplica" })).toBe("");
    expect(html({ estado: "renovacion_rechazada", pago_id: "p1", motivo_rechazo: null, reenvio_hasta: "x", dias_restantes: 2, texto: "t" })).toBe("");
  });
});

describe("PerfilVista: elegir día y hora según la vigencia", () => {
  const USUARIO = { id: "u1", nombre: "Ana", correo: "ana@tiza.test", celular: "987654321" };
  const activa = { estado: "activa" as const, inicio: "2026-10-01T10:00:00-05:00", fin: "2027-01-01T10:00:00-05:00", dias_restantes: 20 };
  const perfil = (membresia: Parameters<typeof PerfilVista>[0]["perfil"]["membresia"], renovacion: Renovacion) =>
    renderToStaticMarkup(createElement(PerfilVista, { usuario: USUARIO, zona: ZONA, perfil: { membresia, renovacion, avisos: [], proximas: [], historial: [], credito: { saldo_horas: 0, proximo_vencimiento: null, membresia_vencida: false } } }));

  it("vigente: ofrece Elegir día y hora y no ofrece renovar", () => {
    const salida = perfil(activa, { estado: "no_aplica" });
    expect(salida).toContain("Elegir día y hora");
    expect(salida).not.toContain("Renovar mi membresía");
  });

  it("por vencer: ofrece Elegir día y hora y solo informa del vencimiento", () => {
    const salida = perfil(activa, { estado: "por_vencer", fin: "x", dias_restantes: 10, texto: "Tu membresía vence el 1 de enero de 2027." });
    expect(salida).toContain("Elegir día y hora");
    expect(salida).toContain("Tu membresía vence el 1 de enero de 2027.");
    expect(salida).not.toContain("Renovar mi membresía");
  });

  it("vencida: ofrece Renovar mi membresía y no Elegir día y hora", () => {
    const salida = perfil({ estado: "vencida", fin: vencida.estado === "vencida" ? vencida.fin : "" }, vencida);
    expect(salida).toContain("Renovar mi membresía");
    expect(salida).not.toContain("Elegir día y hora");
  });

  it("renovación en revisión: espera, sin Elegir día y hora ni Renovar", () => {
    const salida = perfil({ estado: "vencida", fin: "2026-12-08T10:00:00-05:00" }, { estado: "renovacion_en_revision", pago_id: "p1", texto: "Tu pago de renovación está en revisión." });
    expect(salida).toContain("Tu pago de renovación está en revisión.");
    expect(salida).not.toContain("Elegir día y hora");
    expect(salida).not.toContain("Renovar mi membresía");
  });

  it("sin membresía: el aviso de primera membresía sigue igual y no aparece la renovación", () => {
    const salida = perfil({ estado: "sin_membresia", plazo_vencido: false }, { estado: "no_aplica" });
    expect(salida).toContain("Reservar mi primera limpieza");
    expect(salida).not.toContain("Elegir día y hora");
    expect(salida).not.toContain("Renovar mi membresía");
  });
});
