import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ClienteConCredito, DetalleAdmin } from "@/lib/creditos/consulta";
import { VistaAdmin } from "../VistaAdmin";
import { TEXTO_SIN_CLIENTES, VistaCreditos, VistaCreditosDeCliente } from "./VistaCreditos";

const ZONA = "America/Lima";
const html = (c: unknown, props: Record<string, unknown>) => renderToStaticMarkup(createElement(c as never, props as never));

const ana: ClienteConCredito = { usuario_id: "u-ana", nombre: "Ana Pérez", correo: "ana@tiza.test", saldo_horas: 3.5, proximo_vencimiento: "2027-02-02T10:00:00-05:00", lotes: 2 };

const lote = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  horas_iniciales: 4,
  horas_disponibles: 2,
  creado_en: "2026-11-02T10:00:00-05:00",
  vence_en: "2027-02-02T10:00:00-05:00",
  vigente: true,
  origen: { reserva_id: `o-${id}`, inicio: "2026-11-05T10:00:00-05:00", cancelada_en: "2026-11-02T10:00:00-05:00" },
  ...extra,
});
const detalle: DetalleAdmin = {
  cliente: { usuario_id: "u-ana", nombre: "Ana Pérez", correo: "ana@tiza.test" },
  saldo_horas: 2,
  proximo_vencimiento: { horas: 2, vence_en: "2027-02-02T10:00:00-05:00" },
  lotes: [lote("a"), lote("b", { vigente: false, horas_disponibles: 1, vence_en: "2026-01-02T10:00:00-05:00" })],
  movimientos: [
    { tipo: "generado", horas: 4, fecha: "2026-11-02T10:00:00-05:00", reserva: { id: "o-a", inicio: "2026-11-05T10:00:00-05:00" } },
    { tipo: "usado", horas: 2, fecha: "2026-11-10T10:00:00-05:00", reserva: { id: "d1", inicio: "2026-11-12T10:00:00-05:00" } },
  ],
};

describe("/admin/creditos", () => {
  it("lista vacía", () => {
    expect(html(VistaCreditos, { clientes: [], zona: ZONA })).toContain(TEXTO_SIN_CLIENTES);
  });

  it("un cliente con 2 lotes: saldo, vencimiento, cantidad de lotes y enlace a su detalle", () => {
    const h = html(VistaCreditos, { clientes: [ana], zona: ZONA });
    expect(h).toContain("Ana Pérez");
    expect(h).toContain("Saldo vigente: 3,5 horas");
    expect(h).toContain("vence el 2 de febrero de 2027");
    expect(h).toContain("2 lotes");
    expect(h).toContain('href="/admin/creditos/u-ana"');
  });

  it("un cliente sin crédito vigente lo dice", () => {
    expect(html(VistaCreditos, { clientes: [{ ...ana, saldo_horas: 0, proximo_vencimiento: null, lotes: 1 }], zona: ZONA })).toContain("Sin crédito vigente");
  });

  it("detalle: lotes vigente y vencido, movimientos y sin botones de edición", () => {
    const h = html(VistaCreditosDeCliente, { detalle, zona: ZONA });
    expect(h).toContain("Crédito de Ana Pérez");
    expect(h).toContain("Vigente");
    expect(h).toContain("Vencido");
    expect(h).toContain("Generado: 4 horas");
    expect(h).toContain("Usado: 2 horas");
    expect(h).not.toContain("<button");
    expect(h).not.toContain("<form");
    expect(h).not.toContain("<input");
  });

  it("detalle sin lotes ni movimientos", () => {
    const h = html(VistaCreditosDeCliente, { detalle: { ...detalle, saldo_horas: 0, proximo_vencimiento: null, lotes: [], movimientos: [] }, zona: ZONA });
    expect(h).toContain("Sin crédito vigente");
    expect(h).toContain("Este cliente no tiene lotes de crédito.");
    expect(h).toContain("Aún no hay movimientos.");
  });

  it("la portada enlaza al crédito en horas", () => {
    expect(html(VistaAdmin, { pendientesResenas: null })).toContain('href="/admin/creditos"');
  });
});
