import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { instanteLocal, isoConZona } from "../agenda/horario";
import { limitePrimeraMembresia, sumarMeses, validarVigenciaDeMembresia, validarVigenciaPrimeraMembresia } from "./vigencia";

const lima = (fecha: string, hora: string) => instanteLocal(fecha, hora, "America/Lima");
const enLima = (d: Date) => isoConZona(d, "America/Lima");

describe("sumarMeses", () => {
  it("2 de noviembre de 2026 10:00 + 3 meses = 2 de febrero de 2027 10:00", () => {
    expect(enLima(sumarMeses(lima("2026-11-02", "10:00"), 3))).toBe("2027-02-02T10:00:00-05:00");
  });

  it("recorta al último día del mes de destino", () => {
    expect(enLima(sumarMeses(lima("2026-11-30", "10:00"), 3))).toBe("2027-02-28T10:00:00-05:00");
    expect(enLima(sumarMeses(lima("2026-08-31", "10:00"), 3))).toBe("2026-11-30T10:00:00-05:00");
  });

  it("no cambia el instante original", () => {
    const original = lima("2026-11-02", "10:00");
    const copia = original.getTime();
    sumarMeses(original, 3);
    expect(original.getTime()).toBe(copia);
  });
});

describe("validarVigenciaPrimeraMembresia", () => {
  const ahora = lima("2026-11-02", "10:00"); // lunes

  it("acepta el lunes 1 de febrero de 2027 a las 10:00", () => {
    expect(() => validarVigenciaPrimeraMembresia(VALORES_DEL_DISENO, ahora, lima("2027-02-01", "10:00"))).not.toThrow();
  });

  it("rechaza el martes 2 de febrero a las 10:00 con 422 y la última fecha", () => {
    let error: unknown;
    try {
      validarVigenciaPrimeraMembresia(VALORES_DEL_DISENO, ahora, lima("2027-02-02", "10:00"));
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ status: 422, codigo: "datos_invalidos" });
    expect((error as Error).message).toContain("2 de febrero de 2027");
  });

  it("acepta el mismo día del límite si el inicio es antes de la hora exacta", () => {
    expect(() => validarVigenciaPrimeraMembresia(VALORES_DEL_DISENO, ahora, lima("2027-02-02", "08:00"))).not.toThrow();
  });

  it("con membresia_meses 2 el límite cambia", () => {
    const config = { ...VALORES_DEL_DISENO, membresia_meses: 2 };
    expect(enLima(limitePrimeraMembresia(config, ahora))).toBe("2027-01-02T10:00:00-05:00");
    expect(() => validarVigenciaPrimeraMembresia(config, ahora, lima("2027-01-04", "10:00"))).toThrow(/2 de enero de 2027/);
    expect(() => validarVigenciaPrimeraMembresia(config, ahora, lima("2027-01-02", "08:00"))).not.toThrow();
  });
});

describe("validarVigenciaDeMembresia", () => {
  const fin = lima("2027-01-10", "12:00");
  const cuando = (inicio: Date, limite = fin) => {
    try {
      validarVigenciaDeMembresia(VALORES_DEL_DISENO, limite, inicio);
      return null;
    } catch (e) {
      return e as { status: number; message: string };
    }
  };

  it("30 minutos antes del fin pasa", () => {
    expect(cuando(new Date(fin.getTime() - 30 * 60_000))).toBeNull();
  });

  it("igual al fin falla con 422 y pide renovar", () => {
    expect(cuando(fin)).toMatchObject({ status: 422, message: expect.stringContaining("10 de enero de 2027") });
    expect(cuando(fin)?.message).toMatch(/renueva tu membresía/);
  });

  it("un día después falla", () => {
    expect(cuando(lima("2027-01-12", "10:00"))).toMatchObject({ status: 422 });
  });

  it("con el fin ya pasado falla para cualquier fecha posterior", () => {
    const pasado = lima("2026-10-10", "12:00");
    expect(cuando(lima("2026-11-05", "10:00"), pasado)).toMatchObject({ status: 422 });
    expect(cuando(lima("2027-03-05", "10:00"), pasado)).toMatchObject({ status: 422 });
  });

  it("la fecha del mensaje es la de Lima aunque el fin caiga cerca de la medianoche UTC", () => {
    // 2027-01-10 23:30 en Lima es 2027-01-11 04:30 UTC: el mensaje dice 10, no 11.
    const cerca = lima("2027-01-10", "23:30");
    expect(cuando(new Date(cerca.getTime() + 1000), cerca)?.message).toContain("10 de enero de 2027");
  });
});
