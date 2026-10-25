import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Horario } from "@/lib/agenda/disponibilidad";
import { diasReservables } from "@/lib/reservas/asistente/dias";
import { DIRECCION_INICIAL } from "@/lib/reservas/asistente/estado";
import { PasoDireccion } from "./PasoDireccion";
import { PasoFecha, type DisponibilidadDelDia } from "./PasoFecha";

const nada = () => {};
const DIAS = diasReservables("2026-11-04", "2027-02-02");
const LIMITE = "2027-02-02T12:00:00-05:00";

const horarios: Horario[] = [
  { hora: "08:00", inicio: "2026-11-09T08:00:00-05:00", disponible: false, motivo: "anticipacion" },
  { hora: "08:30", inicio: "2026-11-09T08:30:00-05:00", disponible: false, motivo: "sin_cupo" },
  { hora: "09:00", inicio: "2026-11-09T09:00:00-05:00", disponible: true },
];

const fecha = (disponibilidad: DisponibilidadDelDia, extra: Partial<Parameters<typeof PasoFecha>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(PasoFecha, {
      dias: DIAS,
      limite: LIMITE,
      dia: "2026-11-09",
      horario: null,
      disponibilidad,
      mensaje: null,
      onDia: nada,
      onHorario: nada,
      onReintentar: nada,
      ...extra,
    }),
  );

// Devuelve el botón de un horario (de "<button" a "</button>").
const boton = (html: string, hora: string) => {
  const m = new RegExp(`<button[^>]*>${hora}</button>`).exec(html);
  if (!m) throw new Error(`No hay botón para ${hora}`);
  return m[0];
};

describe("PasoFecha", () => {
  it("un horario sin cupo y uno sin anticipación salen en gris y deshabilitados; el libre no", () => {
    const html = fecha({ estado: "listo", atendido: true, horarios });
    expect(boton(html, "08:00")).toContain("disabled");
    expect(boton(html, "08:00")).toContain("horaNoDisponible");
    expect(boton(html, "08:30")).toContain("disabled");
    expect(boton(html, "08:30")).toContain("horaNoDisponible");
    expect(boton(html, "09:00")).not.toContain("disabled");
    expect(boton(html, "09:00")).not.toContain("horaNoDisponible");
  });

  it("explica el motivo a quien usa lector de pantalla", () => {
    const html = fecha({ estado: "listo", atendido: true, horarios });
    expect(html).toContain('aria-label="08:30, sin cupo"');
    expect(html).toContain("no alcanza la anticipación");
  });

  it("ningún domingo es seleccionable", () => {
    const html = fecha({ estado: "sin_elegir" }, { dia: null });
    expect(html).not.toContain('aria-label="domingo');
    expect(html).toContain('aria-label="lunes 9 de noviembre"');
    expect(html).toContain('aria-label="sábado 7 de noviembre"');
  });

  it("el último día respeta el límite: los horarios desde ese instante salen deshabilitados", () => {
    const ultimo: Horario[] = [
      { hora: "11:30", inicio: "2027-02-02T11:30:00-05:00", disponible: true },
      { hora: "12:00", inicio: "2027-02-02T12:00:00-05:00", disponible: true },
      { hora: "12:30", inicio: "2027-02-02T12:30:00-05:00", disponible: true },
    ];
    const html = fecha({ estado: "listo", atendido: true, horarios: ultimo }, { dia: "2027-02-02" });
    expect(boton(html, "11:30")).not.toContain("disabled");
    expect(boton(html, "12:00")).toContain("disabled");
    expect(boton(html, "12:30")).toContain("disabled");
    expect(html).toContain("fuera del plazo de tu primera membresía");
    expect(DIAS[DIAS.length - 1]).toBe("2027-02-02");
    expect(html).not.toContain("3 de febrero");
  });

  it("muestra el aviso del servidor (409 de cupo) arriba", () => {
    const html = fecha({ estado: "sin_elegir" }, { dia: null, mensaje: "Esa hora ya no está libre. Elige otra." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Esa hora ya no está libre. Elige otra.");
  });

  it("muestra la carga, el error con reintento y el día sin atención", () => {
    expect(fecha({ estado: "cargando" })).toContain("Buscando horarios");
    const conError = fecha({ estado: "error", mensaje: "No pudimos conectar con Tiza." });
    expect(conError).toContain("No pudimos conectar con Tiza.");
    expect(conError).toContain("Intentar de nuevo");
    expect(fecha({ estado: "listo", atendido: false, horarios: [] })).toContain("no hay atención");
  });

  it("marca el horario elegido", () => {
    const html = fecha({ estado: "listo", atendido: true, horarios }, { horario: { hora: "09:00", inicio: horarios[2].inicio } });
    expect(boton(html, "09:00")).toContain('aria-pressed="true"');
  });
});

describe("PasoDireccion", () => {
  const html = renderToStaticMarkup(createElement(PasoDireccion, { valor: DIRECCION_INICIAL, onCambio: nada }));

  it("muestra los cinco campos, tres obligatorios", () => {
    for (const nombre of ["distrito", "calle", "numero", "departamento", "referencias"]) expect(html).toContain(`name="${nombre}"`);
    expect((html.match(/required/g) ?? []).length).toBe(3);
  });

  it("no pide nombre ni celular", () => {
    expect(html).not.toMatch(/name="(nombre|celular|telefono)"/);
    expect(html).not.toContain('type="tel"');
  });

  it("preselecciona el distrito que llegó de la landing", () => {
    const conDistrito = renderToStaticMarkup(createElement(PasoDireccion, { valor: { ...DIRECCION_INICIAL, distrito: "Miraflores" }, onCambio: nada }));
    expect(conDistrito).toMatch(/<option value="Miraflores" selected/);
  });
});
