import { describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { ErrorApi } from "../errores";
import { consultarDisponibilidad } from "./consulta";
import { instanteLocal } from "./horario";
import { crearRutaDisponibilidad } from "./rutas";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const AHORA = instanteLocal("2026-11-02", "10:00", "America/Lima");
const USUARIO = { id: "u1", correo: "ana@correo.com", nombre: "Ana", celular: "987654321", rol: "cliente" as const };

function ruta({
  conSesion = true,
  leerConfig = async () => VALORES_DEL_DISENO,
  leerOcupacion = async () => ({ equipos: [{ id: 1 }, { id: 2 }], ocupadas: [] }),
}: {
  conSesion?: boolean;
  leerConfig?: () => Promise<typeof VALORES_DEL_DISENO>;
  leerOcupacion?: () => Promise<{ equipos: { id: number }[]; ocupadas: [] }>;
} = {}) {
  return crearRutaDisponibilidad({
    sesion: async () => {
      if (!conSesion) throw ErrorApi.sinSesion();
      return USUARIO;
    },
    consultar: (args) => consultarDisponibilidad(args, { leerConfig, leerOcupacion }),
    // La vigencia de la membresía tiene sus propias pruebas (src/lib/membresia/vigencia-miembro.test.ts).
    vigencia: async () => {},
    ahora: () => AHORA,
  });
}

const pedir = (r: ReturnType<typeof ruta>, consulta: string) => r(new Request(`http://localhost:3000/api/disponibilidad?${consulta}`));
const ESTANDAR = "tipo=estandar&dormitorios=2&banos=1";

describe("GET /api/disponibilidad", () => {
  it("responde 401 sin sesión con el formato único de error", async () => {
    const res = await pedir(ruta({ conSesion: false }), `fecha=2026-12-01&${ESTANDAR}`);
    expect(res.status).toBe(401);
    expect((await res.json()).error.codigo).toBe("sin_sesion");
  });

  it.each([["fecha=2026-02-30"], ["fecha=mañana"], [""]])("responde 422 con la fecha inválida (%j)", async (fecha) => {
    const res = await pedir(ruta(), `${fecha}&${ESTANDAR}`);
    expect(res.status).toBe(422);
    expect((await res.json()).error.mensaje).toMatch(/fecha válida/);
  });

  it.each([
    ["un paquete de 5 h", "tipo=paquete&horas=5", /paquete de horas no existe/],
    ["una estándar sin baños", "tipo=estandar&dormitorios=2&banos=0", /al menos 1 baño/],
    ["un tipo desconocido", "tipo=lujo&dormitorios=2&banos=1", /tipo de servicio/],
    ["dormitorios ausentes", "tipo=estandar&banos=1", /dormitorios/],
    ["baños que no son número", "tipo=estandar&dormitorios=2&banos=dos", /baños/],
  ])("responde 422 con %s", async (_nombre, servicio, mensaje) => {
    const res = await pedir(ruta(), `fecha=2026-12-01&${servicio}`);
    expect(res.status).toBe(422);
    expect((await res.json()).error.mensaje).toMatch(mensaje);
  });

  it("responde 200 con 13 horarios para una estándar 2/1 en un martes futuro, sin caché", async () => {
    const res = await pedir(ruta(), `fecha=2026-12-01&${ESTANDAR}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const cuerpo = await res.json();
    expect(cuerpo.fecha).toBe("2026-12-01");
    expect(cuerpo.atendido).toBe(true);
    expect(cuerpo.horarios).toHaveLength(13);
    expect(cuerpo.horarios[0]).toEqual({ hora: "08:00", inicio: "2026-12-01T08:00:00-05:00", disponible: true });
    expect(cuerpo.horarios.at(-1).hora).toBe("14:00");
  });

  it("acepta el paquete de 8 h", async () => {
    const res = await pedir(ruta(), "fecha=2026-12-01&tipo=paquete&horas=8");
    expect((await res.json()).horarios).toHaveLength(5);
  });

  it("un domingo responde atendido false y sin horarios", async () => {
    const res = await pedir(ruta(), `fecha=2026-12-06&${ESTANDAR}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fecha: "2026-12-06", atendido: false, horarios: [] });
  });

  it("no consulta la base con parámetros inválidos", async () => {
    const leerConfig = vi.fn(async () => VALORES_DEL_DISENO);
    await pedir(ruta({ leerConfig }), `fecha=2026-02-30&${ESTANDAR}`);
    expect(leerConfig).not.toHaveBeenCalled();
  });

  it("dos fallos de conexión dan 503 con 'Inténtalo en unos segundos.'", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const leerConfig = vi.fn(async () => {
      throw Object.assign(new Error("connection terminated"), { code: "ECONNRESET" });
    });
    const res = await pedir(ruta({ leerConfig }), `fecha=2026-12-01&${ESTANDAR}`);
    expect(res.status).toBe(503);
    expect((await res.json()).error.mensaje).toBe("Inténtalo en unos segundos.");
    expect(leerConfig).toHaveBeenCalledTimes(2);
  });

  it("reintenta un corte de conexión que Drizzle envolvió en DrizzleQueryError", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let llamadas = 0;
    const leerOcupacion = async () => {
      llamadas++;
      if (llamadas === 1) throw Object.assign(new Error("Failed query: select ..."), { cause: { code: "ECONNRESET" } });
      return { equipos: [{ id: 1 }], ocupadas: [] as [] };
    };
    const res = await pedir(ruta({ leerOcupacion }), `fecha=2026-12-01&${ESTANDAR}`);
    expect(res.status).toBe(200);
    expect(llamadas).toBe(2);
  });

  it("un error de datos no se reintenta y sale como 500 genérico", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const leerOcupacion = vi.fn(async () => {
      throw Object.assign(new Error("Failed query"), { cause: { code: "42P01" } });
    });
    const res = await pedir(ruta({ leerOcupacion }), `fecha=2026-12-01&${ESTANDAR}`);
    expect(res.status).toBe(500);
    expect(leerOcupacion).toHaveBeenCalledTimes(1);
  });
});
