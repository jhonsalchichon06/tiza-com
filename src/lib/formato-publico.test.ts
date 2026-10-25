import { describe, expect, it } from "vitest";
import { describirHorario, formatearHoras, formatearSoles } from "./formato-publico";

describe("formato público", () => {
  it.each([[6600, "S/ 66"], [19350, "S/ 193,50"], [22005, "S/ 220,05"]])("%i → %s", (c, t) => {
    expect(formatearSoles(c)).toBe(t);
  });
  it.each([[1, "1 hora"], [3, "3 horas"], [3.5, "3,5 horas"]])("%d → %s", (h, t) => {
    expect(formatearHoras(h)).toBe(t);
  });
  it("describe el horario de los datos", () => {
    expect(describirHorario({ dias: [1, 2, 3, 4, 5, 6], apertura: "08:00", cierre: "18:00" })).toBe("lunes a sábado, de 8 am a 6 pm");
  });
  it("lista días no consecutivos con «y»", () => {
    expect(describirHorario({ dias: [1, 3, 5], apertura: "08:00", cierre: "18:00" })).toBe("lunes, miércoles y viernes, de 8 am a 6 pm");
  });
  it("escribe los minutos del cierre", () => {
    expect(describirHorario({ dias: [1, 2, 3], apertura: "08:00", cierre: "12:30" })).toBe("lunes a miércoles, de 8 am a 12:30 pm");
  });
});
