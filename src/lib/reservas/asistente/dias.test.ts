import { describe, expect, it } from "vitest";
import { describirDia, diasReservables, horarioPermitido, nombreDelDia, nombreDelMes } from "./dias";

describe("diasReservables", () => {
  const dias = diasReservables("2026-11-04", "2027-02-02");

  it("incluye el primero y el último día", () => {
    expect(dias[0]).toBe("2026-11-04");
    expect(dias[dias.length - 1]).toBe("2027-02-02");
  });

  it("no incluye ningún domingo", () => {
    expect(dias).not.toContain("2026-11-08"); // domingo
    for (const d of dias) expect(nombreDelDia(d)).not.toBe("domingo");
  });

  it("recorre todos los demás días", () => {
    // 91 días entre ambas fechas (incluidas) menos 13 domingos
    expect(dias.length).toBe(91 - 13);
    expect(dias).toContain("2026-12-31");
  });

  it("un rango invertido o con fechas inválidas queda vacío", () => {
    expect(diasReservables("2026-11-10", "2026-11-04")).toEqual([]);
    expect(diasReservables("basura", "2026-11-04")).toEqual([]);
  });

  it("un solo domingo no devuelve nada", () => {
    expect(diasReservables("2026-11-08", "2026-11-08")).toEqual([]);
  });
});

describe("horarioPermitido", () => {
  const limite = "2027-02-02T15:30:00-05:00";
  it("antes del límite sí", () => expect(horarioPermitido("2027-02-02T15:00:00-05:00", limite)).toBe(true));
  it("igual al límite no", () => expect(horarioPermitido("2027-02-02T15:30:00-05:00", limite)).toBe(false));
  it("posterior al límite no", () => expect(horarioPermitido("2027-02-02T16:00:00-05:00", limite)).toBe(false));
  it("compara instantes aunque la zona escrita sea distinta", () => {
    expect(horarioPermitido("2027-02-02T20:00:00Z", limite)).toBe(true); // 15:00 en Lima
    expect(horarioPermitido("2027-02-02T21:00:00Z", limite)).toBe(false); // 16:00 en Lima
  });
  it("un valor inválido no es permitido", () => expect(horarioPermitido("x", limite)).toBe(false));
});

describe("nombres", () => {
  it("describe el día y el mes", () => {
    expect(describirDia("2026-11-04")).toBe("miércoles 4 de noviembre");
    expect(nombreDelMes("2026-11-04")).toBe("noviembre de 2026");
  });
});
