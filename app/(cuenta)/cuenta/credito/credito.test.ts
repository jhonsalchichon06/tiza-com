import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CreditosVista } from "@/lib/creditos/consulta";
import { CreditoVista, TEXTO_SIN_LOTES, TEXTO_SIN_MOVIMIENTOS } from "./CreditoVista";

const ZONA = "America/Lima";
const vacio: CreditosVista = { saldo_horas: 0, proximo_vencimiento: null, lotes: [], movimientos: [] };
const html = (c: CreditosVista) => renderToStaticMarkup(createElement(CreditoVista, { creditos: c, zona: ZONA }));

const vigente = {
  id: "l1",
  horas_iniciales: 4,
  horas_disponibles: 2.5,
  creado_en: "2026-11-02T10:00:00-05:00",
  vence_en: "2027-02-02T10:00:00-05:00",
  vigente: true,
  origen: { reserva_id: "r0", inicio: "2026-11-05T10:00:00-05:00", cancelada_en: "2026-11-02T10:00:00-05:00" },
};
const vencido = { ...vigente, id: "l2", horas_disponibles: 1, vence_en: "2026-01-02T10:00:00-05:00", vigente: false };

describe("/cuenta/credito", () => {
  it("lote vigente: horas, vencimiento y de qué limpieza viene", () => {
    const h = html({ ...vacio, saldo_horas: 2.5, proximo_vencimiento: { horas: 2.5, vence_en: vigente.vence_en }, lotes: [vigente] });
    expect(h).toContain("Tienes 2,5 horas de crédito.");
    expect(h).toContain("Las primeras 2,5 horas vencen el 2 de febrero de 2027.");
    expect(h).toContain("2,5 horas disponibles de 4 horas");
    expect(h).toContain("Vigente");
    expect(h).toContain("Vence el 2 de febrero de 2027");
    expect(h).toContain("Viene de la limpieza cancelada del jueves 5 de noviembre, 10:00 am");
    expect(h).toContain('data-vigente="si"');
  });

  it("lote vencido: se muestra como vencido y no suma al saldo", () => {
    const h = html({ ...vacio, lotes: [vencido] });
    expect(h).toContain("No tienes crédito por ahora.");
    expect(h).toContain("Vencido");
    expect(h).toContain("Venció el 2 de enero de 2026");
    expect(h).toContain('data-vigente="no"');
  });

  it("movimientos: generado, usado y devuelto con su limpieza y fecha", () => {
    const r = { id: "r1", inicio: "2026-11-12T10:00:00-05:00" };
    const h = html({
      ...vacio,
      movimientos: [
        { tipo: "devuelto", horas: 1.5, fecha: "2026-11-11T10:00:00-05:00", reserva: r },
        { tipo: "usado", horas: 1.5, fecha: "2026-11-10T10:00:00-05:00", reserva: r },
        { tipo: "generado", horas: 4, fecha: "2026-11-02T10:00:00-05:00", reserva: { id: "r0", inicio: "2026-11-05T10:00:00-05:00" } },
      ],
    });
    expect(h).toContain("Volvieron 1,5 horas a tu saldo");
    expect(h).toContain("Usaste 1,5 horas en la limpieza del jueves 12 de noviembre, 10:00 am");
    expect(h).toContain("Crédito de 4 horas por la limpieza cancelada");
    expect(h.indexOf("Volvieron")).toBeLessThan(h.indexOf("Usaste"));
  });

  it("lista vacía: textos de ayuda, sin lotes ni movimientos", () => {
    const h = html(vacio);
    expect(h).toContain(TEXTO_SIN_LOTES);
    expect(h).toContain(TEXTO_SIN_MOVIMIENTOS);
    expect(h).not.toContain("data-lote");
  });
});
