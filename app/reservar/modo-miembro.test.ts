import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  cotizacionDeMiembro,
  MIEMBRO_ESTANDAR_2_1,
  MIEMBRO_CREDITO_CUBRE,
  MIEMBRO_CREDITO_PARCIAL,
  MIEMBRO_SIN_COSTO,
  RESPUESTA_MIEMBRO_201,
  RESPUESTA_MIEMBRO_CONFIRMADA,
} from "@/lib/reservas/asistente/__dobles__/cotizaciones";
import { AVISO_DEMOSTRACION } from "@/lib/aviso-demo";
import { PasoFecha, TEXTO_LIMITE_MIEMBRO } from "./PasoFecha";
import { PasoListo } from "./PasoListo";
import { PasoPago } from "./PasoPago";
import { ResumenCotizacion } from "./ResumenCotizacion";
import { MembresiaVencida, PagoEnRevision } from "./VistasDeMembresia";

const nada = () => {};
const html = (componente: unknown, props: Record<string, unknown>) => renderToStaticMarkup(createElement(componente as never, props as never));

const pago = (propiedades: Partial<Parameters<typeof PasoPago>[0]> = {}) =>
  html(PasoPago, {
    cotizacion: MIEMBRO_ESTANDAR_2_1(),
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
  });

const DIRECCION = { distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: "", referencias: "" };

describe("vistas de /reservar sin asistente", () => {
  it("membresía vencida: «Tu membresía venció el {fecha}» con el enlace a /cuenta y sin asistente", () => {
    const h = html(MembresiaVencida, { fecha: "15 de diciembre de 2026" });
    expect(h).toContain("Tu membresía venció el 15 de diciembre de 2026");
    expect(h).toContain('href="/cuenta"');
    expect(h).not.toContain("Paso ");
    expect(h).not.toContain("type=\"file\"");
  });

  it("membresía vencida sin fecha legible: el título sigue siendo claro", () => {
    expect(html(MembresiaVencida, { fecha: null })).toContain("Tu membresía venció");
  });

  it("pago en revisión: avisa y enlaza a la cuenta", () => {
    const h = html(PagoEnRevision, {});
    expect(h).toContain("Tu pago está en revisión");
    expect(h).toContain('href="/cuenta"');
  });
});

describe("ResumenCotizacion en modo miembro", () => {
  it("muestra el precio de lista, el descuento de miembro y el total del servidor, sin la línea de la membresía", () => {
    const c = MIEMBRO_ESTANDAR_2_1();
    const h = html(ResumenCotizacion, { cotizacion: c });
    expect(h).toContain("Descuento de miembro");
    expect(h).toContain("S/ 129");
    expect(h).toContain("S/ 12,90");
    expect(h).toContain("S/ 116,10");
    expect(h).not.toContain("Tiza Club");
    expect(h).not.toContain("S/ 267");
  });

  it("con las horas gratis muestra la fila de gratis y solo cobra las adicionales", () => {
    const c = cotizacionDeMiembro({ tipo: "profunda", dormitorios: 2, banos: 1 }, { aplicaGratis: true });
    const h = html(ResumenCotizacion, { cotizacion: c });
    expect(h).toContain("Gratis por ser tu primera limpieza");
    expect(h).toContain("Horas adicionales");
    expect(h).toContain("S/ 69,66");
  });

  it("el resumen también avisa del crédito (cubre todo o una parte)", () => {
    expect(html(ResumenCotizacion, { cotizacion: MIEMBRO_CREDITO_CUBRE() })).toContain("Tu crédito de 4 horas cubre esta limpieza.");
    const parcial = html(ResumenCotizacion, { cotizacion: MIEMBRO_CREDITO_PARCIAL() });
    expect(parcial).toContain("Usaremos 2 horas de tu crédito.");
    expect(parcial).toContain("Crédito en horas");
  });

  it("sin costo dice «Esta limpieza no tiene costo»", () => {
    const h = html(ResumenCotizacion, { cotizacion: MIEMBRO_SIN_COSTO() });
    expect(h).toContain("Esta limpieza no tiene costo");
    expect(h).not.toContain("Descuento de miembro");
  });

  it("un miembro que ya tuvo su gratis no recibe el aviso de «ya tienes una limpieza gratis»; el hogar sí", () => {
    const cliente = { ...MIEMBRO_ESTANDAR_2_1(), motivo_sin_gratis: "cliente" as const };
    expect(html(ResumenCotizacion, { cotizacion: cliente })).not.toContain("limpieza gratis reservada o realizada");
    const hogar = { ...MIEMBRO_ESTANDAR_2_1(), motivo_sin_gratis: "hogar" as const };
    expect(html(ResumenCotizacion, { cotizacion: hogar })).toContain("Otra cuenta ya recibió la limpieza gratis");
  });
});

describe("PasoPago en modo miembro", () => {
  it("con costo muestra solo el monto de la limpieza, el QR o la CCI y el aviso de demostración", () => {
    const h = pago({ metodo: "yape" });
    expect(h).toContain("S/ 116,10");
    expect(h).not.toContain("Tiza Club");
    expect(h).not.toContain("no se reembolsa");
    expect(h).toContain("Tu reserva queda en espera hasta que revisemos tu pago (máximo 24 horas)");
    expect(h).toContain("<img");
    expect(h).toContain(AVISO_DEMOSTRACION);
    expect(h).toContain("Total a pagar");
  });

  it("con monto 0 no pide método ni comprobante y el botón confirma directamente", () => {
    const h = pago({ cotizacion: MIEMBRO_SIN_COSTO() });
    expect(h).toContain("Esta limpieza no tiene costo");
    expect(h).not.toContain("¿Cómo vas a pagar?");
    expect(h).not.toContain('type="file"');
    expect(h).not.toContain("<img");
    expect(/<button[^>]*>Confirmar mi reserva<\/button>/.exec(h)?.[0]).not.toContain("disabled");
  });

  it("con el crédito cubriendo todo: «Tu crédito de 4 horas cubre esta limpieza.», sin paso de pago ni comprobante", () => {
    const h = pago({ cotizacion: MIEMBRO_CREDITO_CUBRE() });
    expect(h).toContain("Tu crédito de 4 horas cubre esta limpieza.");
    expect(h).toContain("Esta limpieza no tiene costo");
    expect(h).not.toContain("¿Cómo vas a pagar?");
    expect(h).not.toContain('type="file"');
    expect(h).not.toContain(AVISO_DEMOSTRACION);
    expect(/<button[^>]*>Confirmar mi reserva<\/button>/.exec(h)?.[0]).not.toContain("disabled");
  });

  it("con el crédito cubriendo una parte: «Usaremos 2 horas de tu crédito.» antes del monto y sigue pidiendo comprobante", () => {
    const h = pago({ cotizacion: MIEMBRO_CREDITO_PARCIAL() });
    expect(h).toContain("Usaremos 2 horas de tu crédito.");
    expect(h.indexOf("Usaremos 2 horas de tu crédito.")).toBeLessThan(h.indexOf("Total a pagar"));
    expect(h).toContain("S/ 58,05");
    expect(h).toContain('type="file"');
    expect(/<button[^>]*>Confirmar mi reserva<\/button>/.exec(h)?.[0]).toContain("disabled");
  });

  it("sin crédito no aparece ningún mensaje de crédito", () => {
    expect(pago()).not.toContain("crédito");
  });

  it("con costo sigue exigiendo método y comprobante", () => {
    expect(/<button[^>]*>Confirmar mi reserva<\/button>/.exec(pago())?.[0]).toContain("disabled");
    expect(/<button[^>]*>Confirmar mi reserva<\/button>/.exec(pago({ metodo: "yape", comprobante: "c/1.jpg" }))?.[0]).not.toContain("disabled");
  });

  it("un pago aprobado esperando horario muestra el mensaje con el enlace a la cuenta y no deja reintentar", () => {
    const h = pago({
      cotizacion: MIEMBRO_SIN_COSTO(),
      mensaje: "Tienes un pago aprobado esperando horario. Elige tu nuevo día y hora desde tu cuenta.",
      bloqueado: true,
      enlaceBloqueo: "/cuenta",
    });
    expect(h).toContain("Tienes un pago aprobado esperando horario");
    expect(h).toContain('href="/cuenta"');
    expect(h).not.toContain("Revisar mis datos");
    expect(/<button[^>]*>Confirmar mi reserva<\/button>/.exec(h)?.[0]).toContain("disabled");
  });

  it("sin enlace de bloqueo no muestra el enlace", () => {
    expect(pago({ mensaje: "Ya tienes una reserva esperando la aprobación de tu pago.", bloqueado: true })).not.toContain("Ir a mi cuenta");
  });
});

describe("PasoListo según el estado de la reserva", () => {
  const listo = (respuesta: Parameters<typeof PasoListo>[0]["respuesta"]) => html(PasoListo, { respuesta, direccion: DIRECCION, esperaHoras: 24 });

  it("en espera: el texto del plazo, el pago en revisión y el aviso de demostración", () => {
    const h = listo(RESPUESTA_MIEMBRO_201);
    expect(h).toContain("en espera hasta que revisemos el pago (máximo 24 horas)");
    expect(h).toContain("Pago en revisión");
    expect(h).toContain("S/ 116,10");
    expect(h).toContain(AVISO_DEMOSTRACION);
  });

  it("confirmada: dice que la limpieza está confirmada y no habla de la revisión del pago", () => {
    const h = listo(RESPUESTA_MIEMBRO_CONFIRMADA);
    expect(h).toContain("Tu limpieza quedó confirmada");
    expect(h).not.toContain("Pago en revisión");
    expect(h).not.toContain("revisemos el pago");
    expect(h).toContain('href="/cuenta"');
  });
});

describe("PasoFecha en modo miembro", () => {
  const fecha = (propiedades: Record<string, unknown> = {}) =>
    html(PasoFecha, {
      dias: ["2026-11-04"],
      limite: "2026-11-04T12:00:00-05:00",
      textoLimite: TEXTO_LIMITE_MIEMBRO,
      dia: "2026-11-04",
      horario: null,
      disponibilidad: {
        estado: "listo",
        atendido: true,
        horarios: [
          { hora: "08:00", inicio: "2026-11-04T08:00:00-05:00", disponible: true },
          { hora: "13:00", inicio: "2026-11-04T13:00:00-05:00", disponible: true },
        ],
      },
      mensaje: null,
      onDia: nada,
      onHorario: nada,
      onReintentar: nada,
      ...propiedades,
    });

  it("los horarios posteriores al fin de la membresía salen en gris y deshabilitados con su motivo", () => {
    const h = fecha();
    expect(h).toContain('aria-label="13:00, fuera de la vigencia de tu membresía"');
    expect(/<button[^>]*aria-label="13:00[^"]*"[^>]*>/.exec(h)?.[0]).toContain("disabled");
    expect(/<button[^>]*aria-label="08:00"[^>]*>/.exec(h)?.[0]).not.toContain("disabled");
  });

  it("sin días disponibles invita a renovar", () => {
    expect(fecha({ dias: [], dia: null })).toContain("Renueva tu membresía desde tu cuenta");
  });
});

// ----- Ninguna cifra ni plazo escritos en los componentes del modo miembro -----
function archivosDe(directorio: string): string[] {
  return readdirSync(directorio).flatMap((nombre) => {
    const ruta = join(directorio, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "__dobles__" ? [] : archivosDe(ruta);
    return /\.(ts|tsx)$/.test(nombre) && !/\.test\.ts$/.test(nombre) ? [ruta] : [];
  });
}

describe("el código del modo miembro no escribe el descuento, un precio ni un plazo", () => {
  const raiz = process.cwd();
  const fuentes = [
    ...archivosDe(join(raiz, "app", "reservar")),
    ...archivosDe(join(raiz, "src", "lib", "reservas", "asistente")),
  ].map((ruta) => ({ ruta, texto: readFileSync(ruta, "utf8") }));

  it("ningún archivo escribe un porcentaje (10%)", () => {
    expect(fuentes.filter((f) => /\d+ ?%/.test(f.texto)).map((f) => f.ruta)).toEqual([]);
  });

  it("ningún archivo escribe un precio en soles ni el plazo de la espera", () => {
    expect(fuentes.filter((f) => /S\/ ?\d/.test(f.texto) || /\b24\b/.test(f.texto)).map((f) => f.ruta)).toEqual([]);
  });
});
