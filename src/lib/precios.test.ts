import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "./__fixtures__/configuracion";
import type { Configuracion } from "./configuracion";
import { ErrorApi } from "./errores";
import { calcularServicio, type EntradaServicio } from "./precios";

const calcular = (entrada: EntradaServicio, config: Configuracion = VALORES_DEL_DISENO) => calcularServicio(config, entrada);
const tamano = (tipo: "estandar" | "profunda" | "mudanza", dormitorios: number, banos: number, extra = {}) =>
  ({ tipo, dormitorios, banos, ...extra }) as EntradaServicio;

const errorDe = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("no lanzó");
};

describe("niveles y horas de trabajo", () => {
  it.each([
    [0, 1, 2, 1],
    [1, 1, 3, 2],
    [2, 1, 4, 3],
    [1, 2, 4, 3],
    [2, 2, 4, 3],
    [3, 2, 6, 4],
    [5, 4, 6, 4],
  ])("estándar de %i dormitorios y %i baños dura %d h (nivel %d)", (dormitorios, banos, horas, nivel) => {
    const r = calcular(tamano("estandar", dormitorios, banos));
    expect(r.horas_trabajo).toBe(horas);
    expect(r.nivel).toBe(nivel);
  });

  it("suma 1 h a la profunda y 2 h a la mudanza", () => {
    expect(["estandar", "profunda", "mudanza"].map((t) => calcular(tamano(t as "estandar", 2, 1)).horas_trabajo)).toEqual([4, 5, 6]);
  });

  it("toma las horas de la configuración, no del código", () => {
    const config = structuredClone(VALORES_DEL_DISENO);
    config.niveles_hogar[1].horas = 3.5;
    expect(calcular(tamano("estandar", 1, 1), config).horas_trabajo).toBe(3.5);
    expect(calcular(tamano("estandar", 1, 1)).horas_trabajo).toBe(3);
  });
});

describe("precio de lista", () => {
  it("por tamaño: 2 dormitorios y 1 baño", () => {
    expect(["estandar", "profunda", "mudanza"].map((t) => calcular(tamano(t as "estandar", 2, 1)).precio_lista)).toEqual([12900, 19350, 21930]);
  });

  it("nivel mínimo: 0 dormitorios y 1 baño en estándar", () => {
    expect(calcular(tamano("estandar", 0, 1)).precio_lista).toBe(6600);
  });

  it.each([
    [3, 9900],
    [4, 12900],
    [6, 18900],
    [8, 23900],
  ])("paquete de %i h cuesta %i céntimos y no tiene nivel", (horas, precio) => {
    const r = calcular({ tipo: "paquete", horas });
    expect(r.precio_lista).toBe(precio);
    expect(r.horas_trabajo).toBe(horas);
    expect(r.horas_agenda).toBe(horas);
    expect(r.nivel).toBeNull();
  });
});

describe("apoyo extra y horas de agenda", () => {
  it.each([
    ["profunda 2/1 (5 h)", tamano("profunda", 2, 1), 5],
    ["mudanza 2/2 (6 h)", tamano("mudanza", 2, 2), 6],
    ["estándar 5/4 (6 h)", tamano("estandar", 5, 4), 6],
    ["paquete de 8 h", { tipo: "paquete", horas: 8 } as EntradaServicio, 8],
  ])("%s no lleva apoyo y ocupa sus horas completas", (_nombre, entrada, agenda) => {
    const r = calcular(entrada);
    expect(r.requiere_apoyo).toBe(false);
    expect(r.horas_agenda).toBe(agenda);
  });

  it("profunda 3/2 (7 h) y mudanza 3/1 (8 h) llevan apoyo y ocupan 3,5 h y 4 h", () => {
    const profunda = calcular(tamano("profunda", 3, 2));
    const mudanza = calcular(tamano("mudanza", 3, 1));
    expect([profunda.requiere_apoyo, profunda.horas_trabajo, profunda.horas_agenda]).toEqual([true, 7, 3.5]);
    expect([mudanza.requiere_apoyo, mudanza.horas_trabajo, mudanza.horas_agenda]).toEqual([true, 8, 4]);
  });

  it("el apoyo no cambia el precio", () => {
    expect(calcular(tamano("profunda", 3, 2)).precio_lista).toBe(28350);
  });

  it("redondea hacia arriba al intervalo: 6,5 h dan 3,5 h en la agenda", () => {
    const config = structuredClone(VALORES_DEL_DISENO);
    config.niveles_hogar[3].horas = 6.5;
    const r = calcular(tamano("estandar", 3, 3), config);
    expect(r.horas_trabajo).toBe(6.5);
    expect(r.requiere_apoyo).toBe(true);
    expect(r.horas_agenda).toBe(3.5);
  });
});

describe("descuento de miembro", () => {
  it("estándar 2/1: monto S/ 116,10 y descuento S/ 12,90", () => {
    const r = calcular(tamano("estandar", 2, 1));
    expect([r.subtotal, r.monto, r.descuento]).toEqual([12900, 11610, 1290]);
  });

  it("con un descuento de 0,2 en la configuración el monto es S/ 103,20", () => {
    const config = { ...VALORES_DEL_DISENO, descuento_miembro: 0.2 };
    expect(calcular(tamano("estandar", 2, 1), config).monto).toBe(10320);
  });
});

describe("horas gratis", () => {
  const gratis = { aplicaGratis: true };

  it("profunda 2/1 (5 h): 3 gratis, 2 a cobrar, S/ 69,66", () => {
    const r = calcular(tamano("profunda", 2, 1, gratis));
    expect([r.horas_gratis_aplicadas, r.horas_cobrar, r.monto]).toEqual([3, 2, 6966]);
  });

  it("estándar 1/1 (3 h) y paquete de 3 h salen en S/ 0", () => {
    expect(calcular(tamano("estandar", 1, 1, gratis)).monto).toBe(0);
    expect(calcular({ tipo: "paquete", horas: 3, ...gratis }).monto).toBe(0);
  });

  it("estándar 0/1 (2 h): se aplican 2 horas gratis y no 3", () => {
    const r = calcular(tamano("estandar", 0, 1, gratis));
    expect([r.horas_gratis_aplicadas, r.horas_cobrar, r.monto]).toEqual([2, 0, 0]);
  });

  it("profunda 3/2 (7 h): se cobran 4 h de trabajo, no de agenda, S/ 145,80", () => {
    const r = calcular(tamano("profunda", 3, 2, gratis));
    expect([r.horas_cobrar, r.monto]).toEqual([4, 14580]);
  });

  it("sin aplicaGratis no hay horas gratis", () => {
    expect(calcular(tamano("profunda", 2, 1)).horas_gratis_aplicadas).toBe(0);
  });
});

describe("crédito en horas", () => {
  it("3 h sobre una estándar de 4 h dejan 1 h a cobrar: S/ 29,03 (mitad hacia arriba)", () => {
    const r = calcular(tamano("estandar", 2, 1, { creditoHoras: 3 }));
    expect([r.credito_aplicado, r.horas_cobrar, r.monto]).toEqual([3, 1, 2903]);
  });

  it("6 h sobre 4 h aplican solo 4 y dejan S/ 0", () => {
    const r = calcular(tamano("estandar", 2, 1, { creditoHoras: 6 }));
    expect([r.credito_aplicado, r.horas_cobrar, r.monto]).toEqual([4, 0, 0]);
  });

  it("primero las horas gratis y después el crédito: profunda de 5 h", () => {
    const r = calcular(tamano("profunda", 2, 1, { aplicaGratis: true, creditoHoras: 1 }));
    expect([r.horas_gratis_aplicadas, r.credito_aplicado, r.horas_cobrar, r.monto]).toEqual([3, 1, 1, 3483]);
  });

  it("no consume crédito que las horas gratis ya cubren", () => {
    const r = calcular(tamano("estandar", 1, 1, { aplicaGratis: true, creditoHoras: 2 }));
    expect([r.horas_gratis_aplicadas, r.credito_aplicado]).toEqual([3, 0]);
  });
});

describe("propiedades", () => {
  const entradas: EntradaServicio[] = [];
  for (const tipo of ["estandar", "profunda", "mudanza"] as const) {
    for (let d = 0; d <= 6; d++) for (let b = 1; b <= 5; b++) entradas.push(tamano(tipo, d, b));
  }
  for (const horas of [3, 4, 6, 8]) entradas.push({ tipo: "paquete", horas });

  it("misma entrada, mismo resultado", () => {
    for (const e of entradas) expect(calcular(e)).toEqual(calcular(e));
  });

  it("monto entero, no negativo y monto + descuento = subtotal, con y sin gratis y crédito", () => {
    for (const base of entradas) {
      for (const extra of [{}, { aplicaGratis: true }, { creditoHoras: 1.5 }, { aplicaGratis: true, creditoHoras: 2 }]) {
        const r = calcular({ ...base, ...extra } as EntradaServicio);
        expect(Number.isInteger(r.monto)).toBe(true);
        expect(r.monto).toBeGreaterThanOrEqual(0);
        expect(r.monto + r.descuento).toBe(r.subtotal);
        expect(r.horas_cobrar).toBeGreaterThanOrEqual(0);
        expect(r.horas_gratis_aplicadas + r.credito_aplicado + r.horas_cobrar).toBe(r.horas_trabajo);
      }
    }
  });

  it("no modifica la configuración recibida", () => {
    const copia = structuredClone(VALORES_DEL_DISENO);
    calcular(tamano("mudanza", 3, 2, { aplicaGratis: true, creditoHoras: 1 }));
    expect(VALORES_DEL_DISENO).toEqual(copia);
  });
});

describe("validación de la entrada", () => {
  it("0 dormitorios es válido", () => {
    expect(() => calcular(tamano("estandar", 0, 1))).not.toThrow();
  });

  it.each([
    ["0 baños", tamano("estandar", 2, 0)],
    ["1,5 dormitorios", tamano("estandar", 1.5, 1)],
    ["-1 dormitorios", tamano("estandar", -1, 1)],
    ["1,5 baños", tamano("estandar", 2, 1.5)],
    ["un paquete de 5 h", { tipo: "paquete", horas: 5 } as EntradaServicio],
    ["un tipo desconocido", { tipo: "lujo", dormitorios: 1, banos: 1 } as unknown as EntradaServicio],
    ["crédito negativo", tamano("estandar", 2, 1, { creditoHoras: -1 })],
    ["crédito de 1,3 h", tamano("estandar", 2, 1, { creditoHoras: 1.3 })],
    ["dormitorios ausentes", { tipo: "estandar", banos: 1 } as unknown as EntradaServicio],
  ])("rechaza %s con 422 y un mensaje en español", (_nombre, entrada) => {
    const error = errorDe(() => calcular(entrada));
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error.status).toBe(422);
    expect(error.message).not.toMatch(/invalid|expected/i);
  });

  it("el paquete inexistente lo dice", () => {
    expect(errorDe(() => calcular({ tipo: "paquete", horas: 5 })).message).toMatch(/paquete de horas no existe/);
  });
});
