import { beforeEach, describe, expect, it, vi } from "vitest";
import { crearBdDoble } from "../perfil/__dobles__/bd-doble";
import { leerOpinionesPublicas, leerOpinionesSinFallar, mesEnEspanol, nombreDePila } from "./publicas";

const fila = (extra: Record<string, unknown> = {}) => ({
  nombre: "María del Pilar Quispe Rojas",
  distrito: "Miraflores",
  estrellas: 5,
  comentario: "Dejaron mi casa impecable.",
  inicio: new Date("2026-10-15T15:00:00Z"),
  // Columnas que la consulta real NO pide: si el doble las devolviera, igual no deben salir.
  email: "maria@tiza.test",
  telefono: "999111222",
  calle: "Av. Larco",
  id: "r1",
  estado: "aprobada",
  ...extra,
});

describe("leerOpinionesPublicas", () => {
  it("solo trae lo permitido: exactamente cinco claves, sin apellido, correo, celular, dirección ni ids", async () => {
    const doble = crearBdDoble({ resenas: [[fila()]] });
    const [opinion] = await leerOpinionesPublicas(doble.base);
    expect(Object.keys(opinion).sort()).toEqual(["comentario", "distrito", "estrellas", "mes", "nombrePila"]);
    expect(opinion).toEqual({ nombrePila: "María", distrito: "Miraflores", estrellas: 5, comentario: "Dejaron mi casa impecable.", mes: "octubre de 2026" });
    const texto = JSON.stringify(opinion);
    for (const prohibido of ["Quispe", "Rojas", "maria@", "999111222", "Larco", "r1", "aprobada"]) expect(texto).not.toContain(prohibido);
  });

  it("la consulta filtra por aprobada, ordena por la aprobación más reciente y limita a 6", async () => {
    const doble = crearBdDoble({ resenas: [[]] });
    await leerOpinionesPublicas(doble.base);
    const [lectura] = doble.lecturas();
    expect(lectura.tabla).toBe("resenas");
    expect(lectura.donde?.params).toEqual(["aprobada"]);
    expect(lectura.limite).toBe(6);
  });

  it("sin aprobadas devuelve []", async () => {
    expect(await leerOpinionesPublicas(crearBdDoble({ resenas: [[]] }).base)).toEqual([]);
  });

  it("conserva el orden que devuelve la base (las seis más recientes)", async () => {
    const filas = Array.from({ length: 6 }, (_, i) => fila({ comentario: `Comentario ${i + 1} de prueba` }));
    const opiniones = await leerOpinionesPublicas(crearBdDoble({ resenas: [filas] }).base);
    expect(opiniones.map((o) => o.comentario)).toEqual(filas.map((f) => f.comentario));
  });
});

describe("nombreDePila y mesEnEspanol", () => {
  it("la primera palabra del nombre, o «Cliente» si no hay", () => {
    expect(nombreDePila("María del Pilar Quispe Rojas")).toBe("María");
    expect(nombreDePila("  Luis   Ríos ")).toBe("Luis");
    expect(nombreDePila("")).toBe("Cliente");
    expect(nombreDePila("   ")).toBe("Cliente");
  });

  it("el mes sale en español y en la hora de Lima", () => {
    expect(mesEnEspanol(new Date("2026-10-15T15:00:00Z"))).toBe("octubre de 2026");
    // 2026-11-01 02:00 UTC es el 31 de octubre a las 9 pm en Lima.
    expect(mesEnEspanol(new Date("2026-11-01T02:00:00Z"))).toBe("octubre de 2026");
  });
});

describe("leerOpinionesSinFallar", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("si la consulta falla devuelve [] con el error registrado, después de un reintento", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const corte = Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
    const leer = vi.fn().mockRejectedValue(corte);
    expect(await leerOpinionesSinFallar(leer, 0)).toEqual([]);
    expect(leer).toHaveBeenCalledTimes(2);
    expect(error.mock.calls.some((c) => String(c[0]).includes("sin la sección"))).toBe(true);
  });

  it("un error que no es de conexión también devuelve [] y se registra, sin reintentar", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const leer = vi.fn().mockRejectedValue(new Error('relation "resenas" does not exist'));
    expect(await leerOpinionesSinFallar(leer, 0)).toEqual([]);
    expect(leer).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
  });

  it("un corte seguido de éxito devuelve las opiniones", async () => {
    const opinion = { nombrePila: "Ana", distrito: "Lince", estrellas: 4, comentario: "Muy buen trabajo.", mes: "octubre de 2026" };
    const leer = vi.fn().mockRejectedValueOnce(Object.assign(new Error("fetch failed"), { code: "ECONNRESET" })).mockResolvedValueOnce([opinion]);
    expect(await leerOpinionesSinFallar(leer, 0)).toEqual([opinion]);
  });
});
