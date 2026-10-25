import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { ErrorApi } from "../errores";
import {
  diaDeLaSemana,
  fechaLocal,
  horaLocal,
  instanteLocal,
  iniciosDelDia,
  rangoBloqueado,
  validarFecha,
  validarInicioServicio,
} from "./horario";

const ZONA = "America/Lima";
const config = VALORES_DEL_DISENO;
const lima = (fecha: string, hora: string) => instanteLocal(fecha, hora, ZONA);
const horas = (fecha: string, horasAgenda: number, cfg = config) => iniciosDelDia(cfg, fecha, horasAgenda).map((d) => horaLocal(d, ZONA));

// 2026-12-01 es martes; 04 viernes; 05 sábado; 06 domingo.
const MARTES = "2026-12-01";
const VIERNES = "2026-12-04";
const SABADO = "2026-12-05";
const DOMINGO = "2026-12-06";

const errorDe = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("no lanzó");
};

describe("zona horaria y fechas", () => {
  it("10:00 de Lima son las 15:00 UTC", () => {
    expect(lima(MARTES, "10:00").toISOString()).toBe("2026-12-01T15:00:00.000Z");
  });

  it("vuelve a la hora local y a la fecha local", () => {
    const d = new Date("2026-12-02T02:30:00.000Z"); // 21:30 del 1 de diciembre en Lima
    expect(horaLocal(d, ZONA)).toBe("21:30");
    expect(fechaLocal(d, ZONA)).toBe("2026-12-01");
  });

  it("calcula el día de la semana de la fecha civil", () => {
    expect([MARTES, VIERNES, SABADO, DOMINGO].map(diaDeLaSemana)).toEqual([2, 5, 6, 0]);
  });

  it.each(["2026-02-30", "mañana", "2026-13-01", "2026-1-5", ""])("rechaza la fecha %j", (fecha) => {
    const error = errorDe(() => validarFecha(fecha));
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/fecha válida/);
  });

  it("rechaza una fecha ausente", () => {
    expect(errorDe(() => validarFecha(undefined)).status).toBe(422);
  });

  it("acepta un 29 de febrero de año bisiesto", () => {
    expect(validarFecha("2028-02-29")).toBe("2028-02-29");
    expect(errorDe(() => validarFecha("2027-02-29")).status).toBe(422);
  });
});

describe("iniciosDelDia", () => {
  it("sábado con una estándar 2/1 (4 h): 13 inicios, de 08:00 a 14:00", () => {
    const h = horas(SABADO, 4);
    expect(h).toHaveLength(13);
    expect([h[0], h[h.length - 1]]).toEqual(["08:00", "14:00"]);
  });

  it("martes con el paquete de 8 h: 5 inicios", () => {
    expect(horas(MARTES, 8)).toEqual(["08:00", "08:30", "09:00", "09:30", "10:00"]);
  });

  it("viernes con una profunda 3/2 (3,5 h en la agenda): 14 inicios, hasta 14:30", () => {
    const h = horas(VIERNES, 3.5);
    expect(h).toHaveLength(14);
    expect(h[h.length - 1]).toBe("14:30");
  });

  it("el domingo no se atiende", () => {
    expect(horas(DOMINGO, 4)).toEqual([]);
  });

  it("toma el cierre y el intervalo de la configuración", () => {
    const cfg = structuredClone(config);
    cfg.horario_atencion.cierre = "17:00";
    cfg.intervalo_horarios_minutos = 60;
    expect(horas(SABADO, 4, cfg)).toEqual(["08:00", "09:00", "10:00", "11:00", "12:00", "13:00"]);
  });

  it("toma los días de atención de la configuración", () => {
    const cfg = structuredClone(config);
    cfg.horario_atencion.dias = [1, 2, 3, 4, 5];
    expect(horas(SABADO, 4, cfg)).toEqual([]);
    cfg.horario_atencion.dias = [0, 1];
    expect(horas(DOMINGO, 4, cfg).length).toBeGreaterThan(0);
  });
});

describe("rangoBloqueado", () => {
  const rango = (fecha: string, hora: string, horasAgenda: number, cfg = config) => {
    const r = rangoBloqueado(cfg, lima(fecha, hora), horasAgenda);
    return [horaLocal(r.fin, ZONA), horaLocal(r.finBloqueo, ZONA)];
  };

  it("estándar 2/1 (4 h) desde 10:00 bloquea hasta las 15:00", () => {
    expect(rango(MARTES, "10:00", 4)).toEqual(["14:00", "15:00"]);
  });

  it("profunda 2/1 (5 h) desde 09:00 bloquea hasta las 15:00", () => {
    expect(rango(MARTES, "09:00", 5)).toEqual(["14:00", "15:00"]);
  });

  it("profunda 3/2 y mudanza 3/1 con apoyo desde 08:00 terminan 11:30 y 12:00 y bloquean hasta 12:30 y 13:00", () => {
    expect(rango(MARTES, "08:00", 3.5)).toEqual(["11:30", "12:30"]);
    expect(rango(MARTES, "08:00", 4)).toEqual(["12:00", "13:00"]);
  });

  it("paquete de 8 h desde 08:00 bloquea hasta las 17:00", () => {
    expect(rango(MARTES, "08:00", 8)).toEqual(["16:00", "17:00"]);
  });

  it("toma el traslado de la configuración (1,5 h → 15:30)", () => {
    expect(rango(MARTES, "10:00", 4, { ...config, traslado_horas: 1.5 })).toEqual(["14:00", "15:30"]);
  });

  it("el rango es semiabierto: el fin del bloqueo es exactamente fin + traslado", () => {
    const r = rangoBloqueado(config, lima(MARTES, "10:00"), 4);
    expect(r.finBloqueo.getTime() - r.fin.getTime()).toBe(3_600_000);
  });
});

describe("validarInicioServicio", () => {
  const ahora = lima("2026-11-25", "10:00");
  const validar = (fecha: string, hora: string, horasAgenda = 4, desde = ahora) =>
    validarInicioServicio(config, desde, lima(fecha, hora), horasAgenda);

  it("acepta un inicio válido", () => {
    expect(() => validar(MARTES, "10:00")).not.toThrow();
    expect(() => validar(SABADO, "14:00")).not.toThrow();
  });

  it("rechaza el domingo e indica lunes a sábado", () => {
    const error = errorDe(() => validar(DOMINGO, "10:00"));
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/lunes a sábado/);
  });

  it("rechaza las 07:30 con el horario de atención", () => {
    const error = errorDe(() => validar(MARTES, "07:30"));
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/8 am a 6 pm/);
  });

  it("rechaza las 15:00 con 4 h porque terminaría a las 19:00", () => {
    const error = errorDe(() => validar(MARTES, "15:00", 4));
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/terminar antes de las 6 pm/);
  });

  it("acepta terminar justo a las 18:00 aunque el traslado pase de esa hora", () => {
    expect(() => validar(MARTES, "14:00", 4)).not.toThrow();
  });

  it("rechaza las 09:15 e indica que los horarios son cada 30 minutos", () => {
    const error = errorDe(() => validar(MARTES, "09:15"));
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/cada 30 minutos/);
  });

  it("rechaza un inicio a 47 h 59 min y acepta exactamente 48 h", () => {
    const inicio = lima(MARTES, "10:00");
    const a48 = new Date(inicio.getTime() - 48 * 3_600_000);
    expect(() => validarInicioServicio(config, a48, inicio, 4)).not.toThrow();
    const error = errorDe(() => validarInicioServicio(config, new Date(a48.getTime() + 60_000), inicio, 4));
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/48 horas de anticipación/);
  });

  it("rechaza una fecha pasada por la anticipación", () => {
    expect(errorDe(() => validar(MARTES, "10:00", 4, lima("2026-12-02", "10:00"))).message).toMatch(/anticipación/);
  });

  it("usa la anticipación de la configuración", () => {
    const cfg = { ...config, anticipacion_minima_horas: 72 };
    const inicio = lima(MARTES, "10:00");
    const ahora60 = new Date(inicio.getTime() - 60 * 3_600_000);
    expect(errorDe(() => validarInicioServicio(cfg, ahora60, inicio, 4)).message).toMatch(/72 horas/);
  });
});
