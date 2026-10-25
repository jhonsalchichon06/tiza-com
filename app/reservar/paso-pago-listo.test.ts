import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AVISO_DEMOSTRACION } from "@/lib/aviso-demo";
import { PROFUNDA_2_1, RESPUESTA_201 } from "@/lib/reservas/asistente/__dobles__/cotizaciones";
import type { Cotizacion } from "@/lib/reservas/cotizar";
import { CCI_TIZA, RUTA_QR_YAPE, TITULAR_TIZA } from "@/lib/reservas/datos-de-pago";
import { PasoListo } from "./PasoListo";
import { PasoPago } from "./PasoPago";
import { ResumenCotizacion } from "./ResumenCotizacion";

const TEXTO_EXACTO = "Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.";
const nada = () => {};

const COTIZACION_26700_6966: Cotizacion = PROFUNDA_2_1();

const pago = (propiedades: Partial<Parameters<typeof PasoPago>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(PasoPago, {
      cotizacion: COTIZACION_26700_6966,
      metodo: null,
      comprobante: null,
      subiendo: false,
      errorDeArchivo: null,
      mensaje: null,
      bloqueado: false,
      enviando: false,
      onMetodo: nada,
      onArchivo: nada,
      onConfirmar: nada,
      onRevisarDatos: nada,
      ...propiedades,
    }),
  );

const DIRECCION = { distrito: "Barranco", calle: "Jr. Junín", numero: "45", departamento: "", referencias: "" };
const listo = (whatsapp: string | null) =>
  renderToStaticMarkup(createElement(PasoListo, { respuesta: { ...RESPUESTA_201, whatsapp }, direccion: DIRECCION, esperaHoras: 24 }));

describe("PasoPago: hogar o cliente que ya tuvo la limpieza gratis", () => {
  const completa = (motivo: "cliente" | "hogar"): Cotizacion => ({
    ...COTIZACION_26700_6966,
    aplica_gratis: false,
    motivo_sin_gratis: motivo,
    horas_gratis_aplicadas: 0,
    horas_cobrar: 5,
    monto: 17415,
    total_a_pagar: 44115,
  });

  it("el motivo hogar muestra el texto, el precio completo y el total del servidor", () => {
    const html = pago({ cotizacion: completa("hogar") });
    expect(html).toContain("Otra cuenta ya recibió la limpieza gratis de esta dirección");
    expect(html).toContain("Horas a pagar");
    expect(html).toContain("S/ 174,15");
    expect(html).toContain("S/ 441,15");
  });

  it("el motivo cliente muestra su texto", () => {
    expect(pago({ cotizacion: completa("cliente") })).toContain("Tu cuenta ya tiene una limpieza gratis reservada o realizada");
  });

  it("si la gratis aplica no muestra ningún aviso de este tipo", () => {
    const html = pago();
    expect(html).not.toContain("Otra cuenta ya recibió");
    expect(html).not.toContain("Tu cuenta ya tiene una limpieza gratis");
    expect(html).toContain("Horas adicionales");
  });
});

describe("PasoPago: resumen", () => {
  it("muestra la membresía, las horas adicionales y el total de la cotización (26700 + 6966 = S/ 336,66)", () => {
    const html = pago();
    expect(COTIZACION_26700_6966.membresia.total).toBe(26700);
    expect(COTIZACION_26700_6966.monto).toBe(6966);
    expect(html).toContain("S/ 89 al mes por 3 meses");
    expect(html).toContain("S/ 267");
    expect(html).toContain("S/ 69,66");
    expect(html).toContain("S/ 336,66");
  });

  it("sin horas adicionales no muestra esa fila", () => {
    const html = pago({ cotizacion: { ...COTIZACION_26700_6966, monto: 0, horas_cobrar: 0, total_a_pagar: 26700 } });
    expect(html).not.toContain("Horas adicionales");
    expect(html).toContain("S/ 267");
  });

  it("explica la espera máxima con el plazo de la cotización", () => {
    expect(pago()).toContain("máximo 24 horas");
  });
});

describe("PasoPago: métodos y datos de pago", () => {
  it("con Yape muestra la imagen del QR de la ruta del módulo, con texto alternativo no vacío", () => {
    const html = pago({ metodo: "yape" });
    const imagen = /<img[^>]*>/.exec(html)?.[0] ?? "";
    expect(imagen).toContain(`src="${RUTA_QR_YAPE}"`);
    const alt = /alt="([^"]*)"/.exec(imagen)?.[1] ?? "";
    expect(alt).not.toBe("");
    expect(alt).toContain("Yape");
    expect(alt).toContain(TITULAR_TIZA);
    expect(html).not.toContain(CCI_TIZA);
  });

  it("con transferencia muestra la CCI y el titular del módulo", () => {
    const html = pago({ metodo: "transferencia" });
    expect(CCI_TIZA).toMatch(/^\d{20}$/);
    expect(html).toContain(CCI_TIZA);
    expect(html).toContain(TITULAR_TIZA);
    expect(html).not.toContain("<img");
  });

  it("sin método pide elegir uno", () => {
    const html = pago();
    expect(html).toContain("Elige Yape o transferencia");
    expect(html).not.toContain("<img");
  });

  it("el campo del comprobante acepta solo JPG, PNG y WebP", () => {
    const html = pago();
    expect(html).toMatch(/type="file"[^>]*accept="image\/jpeg,image\/png,image\/webp,\.jpg,\.jpeg,\.png,\.webp"|accept="image\/jpeg,image\/png,image\/webp,\.jpg,\.jpeg,\.png,\.webp"[^>]*type="file"/);
    expect(html).toContain("5 MB");
  });
});

describe("PasoPago: botón de confirmar", () => {
  const botonConfirmar = (html: string) => /<button[^>]*>(Confirmar mi reserva|Enviando\.\.\.)<\/button>/.exec(html)?.[0] ?? "";

  it("está deshabilitado sin método ni comprobante", () => {
    expect(botonConfirmar(pago())).toContain("disabled");
    expect(botonConfirmar(pago({ metodo: "yape" }))).toContain("disabled");
    expect(botonConfirmar(pago({ comprobante: "c/1.jpg" }))).toContain("disabled");
  });

  it("se habilita con método y comprobante", () => {
    expect(botonConfirmar(pago({ metodo: "yape", comprobante: "c/1.jpg" }))).not.toContain("disabled");
  });

  it("se deshabilita mientras se sube el archivo o se envía la reserva", () => {
    expect(botonConfirmar(pago({ metodo: "yape", comprobante: "c/1.jpg", subiendo: true }))).toContain("disabled");
    const enviando = botonConfirmar(pago({ metodo: "yape", comprobante: "c/1.jpg", enviando: true }));
    expect(enviando).toContain("disabled");
    expect(enviando).toContain("Enviando...");
  });
});

describe("PasoPago: errores", () => {
  it("un 422 muestra el mensaje con la opción Revisar mis datos", () => {
    const html = pago({ metodo: "yape", comprobante: "c/1.jpg", mensaje: "Escribe el número de la dirección." });
    expect(html).toContain("Escribe el número de la dirección.");
    expect(html).toContain("Revisar mis datos");
  });

  it("un 409 de pago en revisión muestra el mensaje sin ofrecer reintentar", () => {
    const html = pago({ metodo: "yape", comprobante: "c/1.jpg", mensaje: "Ya tienes un pago en revisión.", bloqueado: true });
    expect(html).toContain("Ya tienes un pago en revisión.");
    expect(html).not.toContain("Revisar mis datos");
    expect(/<button[^>]*>Confirmar mi reserva<\/button>/.exec(html)?.[0]).toContain("disabled");
  });

  it("muestra el error del archivo junto al campo", () => {
    const html = pago({ errorDeArchivo: "Solo se aceptan imágenes JPG, PNG o WebP." });
    expect(html).toContain("Solo se aceptan imágenes JPG, PNG o WebP.");
  });

  it("indica cuando el comprobante ya se subió", () => {
    expect(pago({ comprobante: "c/1.jpg" })).toContain("Comprobante subido");
  });
});

describe("aviso de demostración en el paso de pago", () => {
  it("el texto exacto es el del PRD y es la constante", () => {
    expect(AVISO_DEMOSTRACION).toBe(TEXTO_EXACTO);
  });

  it.each([
    ["con Yape", "yape" as const],
    ["con transferencia", "transferencia" as const],
    ["sin método", null],
  ])("%s el HTML contiene el aviso en un bloque con role=note dentro del contenedor de los datos de pago", (_n, metodo) => {
    const html = pago({ metodo });
    expect(html).toContain(TEXTO_EXACTO);
    expect(html).toContain(AVISO_DEMOSTRACION);
    expect(html).toMatch(/<p role="note"[^>]*>Sitio de demostración: los pagos son simulados\. No hagas ninguna transferencia ni pago real\.<\/p>/);

    // El aviso va dentro del contenedor de los datos de pago, antes del QR o la CCI.
    const inicio = html.indexOf("datosPago");
    const posicionAviso = html.indexOf(TEXTO_EXACTO);
    expect(inicio).toBeGreaterThan(-1);
    expect(posicionAviso).toBeGreaterThan(inicio);
    const posicionDatos = metodo === "yape" ? html.indexOf("<img") : metodo === "transferencia" ? html.indexOf(CCI_TIZA) : html.length;
    expect(posicionAviso).toBeLessThan(posicionDatos);
  });
});

describe("PasoListo", () => {
  it("con enlace de WhatsApp muestra el botón con ese href, en pestaña nueva", () => {
    const html = listo("https://wa.me/51999999999?text=Hola");
    expect(html).toContain('href="https://wa.me/51999999999?text=Hola"');
    expect(html).toMatch(/<a[^>]*href="https:\/\/wa\.me[^>]*target="_blank"|<a[^>]*target="_blank"[^>]*href="https:\/\/wa\.me/);
    expect(html).toContain("Coordinar por WhatsApp");
  });

  it("con enlace null no muestra el botón", () => {
    const html = listo(null);
    expect(html).not.toContain("wa.me");
    expect(html).not.toContain("WhatsApp");
    expect(html).toContain('href="/cuenta"');
  });

  it("explica la espera y resume lo guardado", () => {
    const html = listo(null);
    expect(html).toContain("en espera hasta que revisemos el pago (máximo 24 horas)");
    expect(html).toContain("Limpieza profunda");
    expect(html).toContain("lunes 9 de noviembre, 09:00");
    expect(html).toContain("Jr. Junín 45, Barranco");
    expect(html).toContain("S/ 336,66");
  });

  it.each([
    ["con enlace de WhatsApp", "https://wa.me/51999999999?text=Hola"],
    ["con enlace null", null],
  ])("%s muestra el aviso de demostración en un bloque con role=note", (_n, enlace) => {
    const html = listo(enlace);
    expect(html).toContain(TEXTO_EXACTO);
    expect(html).toMatch(/<p role="note"[^>]*>Sitio de demostración/);
  });
});

// ----- Sin cifras ni textos escritos a mano en el código del asistente -----
function archivosDe(directorio: string): string[] {
  return readdirSync(directorio).flatMap((nombre) => {
    const ruta = join(directorio, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "__dobles__" ? [] : archivosDe(ruta);
    return /\.(ts|tsx)$/.test(nombre) && !/\.test\.ts$/.test(nombre) ? [ruta] : [];
  });
}

describe("el código del asistente no repite datos que viven en otros módulos", () => {
  const raiz = process.cwd();
  const fuentes = [...archivosDe(join(raiz, "app", "reservar")), ...archivosDe(join(raiz, "src", "lib", "reservas", "asistente"))].map((ruta) => ({
    ruta,
    texto: readFileSync(ruta, "utf8"),
  }));

  it("hay archivos que revisar", () => {
    expect(fuentes.length).toBeGreaterThan(15);
  });

  it("ningún archivo escribe un precio en soles (S/ seguido de una cifra)", () => {
    const con = fuentes.filter((f) => /S\/ ?\d/.test(f.texto)).map((f) => f.ruta);
    expect(con).toEqual([]);
  });

  it("ningún archivo repite el texto del aviso de demostración", () => {
    const con = fuentes.filter((f) => f.texto.includes("Sitio de demostración") || f.texto.includes("los pagos son simulados")).map((f) => f.ruta);
    expect(con).toEqual([]);
  });

  it("ningún archivo escribe la CCI, el titular ni la ruta del QR", () => {
    const con = fuentes
      .filter((f) => f.texto.includes(CCI_TIZA) || f.texto.includes(TITULAR_TIZA) || f.texto.includes("yape.jpeg") || /\b\d{20}\b/.test(f.texto))
      .map((f) => f.ruta);
    expect(con).toEqual([]);
  });

  it("ningún archivo escribe el plazo de 24 horas ni el monto de la membresía", () => {
    const con = fuentes.filter((f) => /\b24\b|\b267\b|\b89\b/.test(f.texto)).map((f) => f.ruta);
    expect(con).toEqual([]);
  });
});

describe("ResumenCotizacion: sin la limpieza gratis", () => {
  const sin: Cotizacion = { ...COTIZACION_26700_6966, aplica_gratis: false, motivo_sin_gratis: "hogar", horas_gratis_aplicadas: 0, horas_cobrar: 5, monto: 17415, total_a_pagar: 44115 };

  it("oculta la fila de horas gratis y explica el motivo", () => {
    const html = renderToStaticMarkup(createElement(ResumenCotizacion, { cotizacion: sin }));
    expect(html).not.toContain("Gratis por ser tu primera limpieza");
    expect(html).toContain("Otra cuenta ya recibió la limpieza gratis de esta dirección");
    expect(html).toContain("S/ 174,15");
  });

  it("con la gratis vigente la muestra y no avisa nada", () => {
    const html = renderToStaticMarkup(createElement(ResumenCotizacion, { cotizacion: COTIZACION_26700_6966 }));
    expect(html).toContain("Gratis por ser tu primera limpieza");
    expect(html).not.toContain("Otra cuenta ya recibió");
  });
});
