import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { calcularDisponibilidad, type Ocupacion } from "./disponibilidad";
import { instanteLocal } from "./horario";

const ZONA = "America/Lima";
const config = VALORES_DEL_DISENO;
const lima = (fecha: string, hora: string) => instanteLocal(fecha, hora, ZONA);

// "Ahora" lejano para que la anticipación no moleste, salvo en las pruebas que la ejercen.
const AHORA_LEJANO = lima("2026-11-02", "10:00");
const DIA = "2026-12-01"; // martes
const equipos = [{ id: 1 }, { id: 2 }];

const ocupa = (equipoId: number, desde: string, hasta: string): Ocupacion => ({
  equipoId,
  inicio: lima(DIA, desde),
  finBloqueo: lima(DIA, hasta),
});

const calcular = (ocupadas: Ocupacion[], opciones: Partial<Parameters<typeof calcularDisponibilidad>[0]> = {}) =>
  calcularDisponibilidad({ config, ahora: AHORA_LEJANO, fecha: DIA, horasAgenda: 2, equipos, ocupadas, ...opciones });

const estado = (d: ReturnType<typeof calcular>, hora: string) => d.horarios.find((h) => h.hora === hora)!;

describe("calcularDisponibilidad por cupo", () => {
  it("sin reservas todo está disponible", () => {
    const d = calcular([]);
    expect(d.atendido).toBe(true);
    expect(d.horarios.every((h) => h.disponible && h.motivo === undefined)).toBe(true);
  });

  it("con un equipo ocupado y el otro libre sigue disponible", () => {
    expect(estado(calcular([ocupa(1, "08:00", "15:00")]), "10:00").disponible).toBe(true);
  });

  it("con los dos equipos ocupados da sin_cupo de 08:00 a 12:30 y disponible a las 13:00", () => {
    const d = calcular([ocupa(1, "08:00", "13:00"), ocupa(2, "10:00", "15:00")]);
    for (const hora of ["08:00", "08:30", "10:00", "12:00", "12:30"]) {
      expect(estado(d, hora)).toMatchObject({ disponible: false, motivo: "sin_cupo" });
    }
    expect(estado(d, "13:00").disponible).toBe(true);
  });

  it("no reparte el rango entre equipos", () => {
    const d = calcular(
      [ocupa(1, "08:00", "10:00"), ocupa(1, "11:30", "14:00"), ocupa(2, "09:00", "12:00")],
      { horasAgenda: 1 },
    );
    expect(estado(d, "10:00")).toMatchObject({ disponible: false, motivo: "sin_cupo" });
  });

  it("un equipo cuyo traslado termina justo a la hora de inicio cuenta como libre", () => {
    const d = calcular([ocupa(1, "08:00", "10:00"), ocupa(2, "08:00", "12:00")]);
    expect(estado(d, "10:00").disponible).toBe(true);
    expect(estado(d, "09:30")).toMatchObject({ disponible: false, motivo: "sin_cupo" });
  });

  it("un tercer equipo libre libera el horario", () => {
    const ocupadas = [ocupa(1, "08:00", "15:00"), ocupa(2, "08:00", "15:00")];
    expect(estado(calcular(ocupadas), "10:00").disponible).toBe(false);
    expect(estado(calcular(ocupadas, { equipos: [...equipos, { id: 3 }] }), "10:00").disponible).toBe(true);
  });

  it("un equipo inactivo no cuenta", () => {
    const ocupadas = [ocupa(1, "08:00", "15:00")];
    expect(estado(calcular(ocupadas, { equipos: [{ id: 1 }, { id: 2, activo: false }] }), "10:00")).toMatchObject({
      disponible: false,
      motivo: "sin_cupo",
    });
  });

  it("sin ningún equipo activo no hay cupo", () => {
    expect(estado(calcular([], { equipos: [] }), "10:00")).toMatchObject({ disponible: false, motivo: "sin_cupo" });
  });
});

describe("anticipación y días sin atención", () => {
  // Lunes 2 de noviembre de 2026, 10:00 (Lima).
  const ahora = lima("2026-11-02", "10:00");

  it("el miércoles 4 los horarios de 08:00 a 09:30 son anticipacion y el de 10:00 está disponible", () => {
    const d = calcular([], { ahora, fecha: "2026-11-04" });
    for (const hora of ["08:00", "08:30", "09:00", "09:30"]) {
      expect(estado(d, hora)).toMatchObject({ disponible: false, motivo: "anticipacion" });
    }
    expect(estado(d, "10:00").disponible).toBe(true);
  });

  it("una fecha pasada es toda anticipacion", () => {
    const d = calcular([], { ahora, fecha: "2026-10-31" });
    expect(d.atendido).toBe(true);
    expect(d.horarios.length).toBeGreaterThan(0);
    expect(d.horarios.every((h) => h.motivo === "anticipacion")).toBe(true);
  });

  it("el domingo no se atiende: atendido false y lista vacía", () => {
    expect(calcular([], { ahora, fecha: "2026-11-08" })).toEqual({ fecha: "2026-11-08", atendido: false, horarios: [] });
  });

  it("la anticipación pesa más que el cupo", () => {
    const d = calcular([ocupa(1, "08:00", "18:00"), ocupa(2, "08:00", "18:00")], {
      ahora: lima("2026-12-01", "07:00"),
    });
    expect(estado(d, "08:00").motivo).toBe("anticipacion");
  });
});

describe("forma de la salida", () => {
  it("cada horario solo trae hora, inicio, disponible y motivo, aunque la ocupación traiga más datos", () => {
    const sucia = [{ ...ocupa(1, "08:00", "15:00"), usuario: "ana@correo.com", direccion: "Av. Larco 123", id: "x" }];
    const d = calcular(sucia);
    for (const h of d.horarios) {
      expect(Object.keys(h).every((k) => ["hora", "inicio", "disponible", "motivo"].includes(k))).toBe(true);
    }
    const texto = JSON.stringify(d);
    expect(texto).not.toMatch(/ana@correo|Larco|equipo/i);
  });

  it("el inicio va en ISO 8601 con la zona de Lima", () => {
    expect(calcular([]).horarios[0].inicio).toBe("2026-12-01T08:00:00-05:00");
  });
});
