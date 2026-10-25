import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "./__fixtures__/configuracion";
import { construirCatalogo } from "./catalogo-publico";
import type { Configuracion } from "./configuracion";
import { construirPreguntas } from "./preguntas";

const preguntas = (cambios: Partial<Configuracion> = {}) =>
  construirPreguntas(construirCatalogo({ ...VALORES_DEL_DISENO, ...cambios }));
const texto = (cambios?: Partial<Configuracion>) => preguntas(cambios).map((p) => `${p.pregunta} ${p.respuesta}`).join("\n");

describe("construirPreguntas", () => {
  it("cubre los temas de la spec", () => {
    const t = texto();
    for (const tema of [/gratis/, /reembolsa/, /por horas o por tamaño/, /Yape/, /CCI/, /anticipación/, /24 horas antes/, /crédito/, /no es automática/, /distritos/, /segunda persona de apoyo/]) {
      expect(t).toMatch(tema);
    }
  });
  it("las horas gratis dicen una por cliente y por hogar y que la renovación no da otra", () => {
    const r = preguntas()[0].respuesta;
    expect(r).toMatch(/3 horas/);
    expect(r).toMatch(/por cliente y por hogar/);
    expect(r).toMatch(/renovación.*no da otra/);
  });
  it("con descuento 0,2 no aparece 10%", () => {
    expect(texto({ descuento_miembro: 0.2 })).toContain("20%");
    expect(texto({ descuento_miembro: 0.2 })).not.toContain("10%");
  });
  it("con anticipación 72 aparece 72 horas y no 48", () => {
    const t = texto({ anticipacion_minima_horas: 72 });
    expect(t).toContain("72 horas");
    expect(t).not.toContain("48");
  });
  it("sin montos de la membresía ni afirmaciones sin respaldo", () => {
    const t = texto();
    expect(t).not.toMatch(/S\/ ?\d/);
    expect(t).not.toMatch(/al mes/);
    expect(t).not.toMatch(/te avisamos cuando llegamos|verificado/i);
    const mes4 = preguntas().find((p) => p.pregunta.startsWith("¿Qué pasa cuando terminan"))!;
    expect(mes4.respuesta).not.toMatch(/S\/|\d/);
  });
});
