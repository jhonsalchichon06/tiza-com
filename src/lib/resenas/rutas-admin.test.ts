import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../errores";
import type { Usuario } from "../sesion";
import { crearRutaAprobar, crearRutaListarResenas, crearRutaRechazar } from "./rutas-admin";

const ADMIN: Usuario = { id: "adm", correo: "a@tiza.test", nombre: "Admin", celular: "999111222", rol: "admin" };
const ID = "44444444-4444-4444-8444-444444444444";
const contexto = (id = ID) => ({ params: Promise.resolve({ id }) });
const sesion = async () => ADMIN;
const sinSesion = async () => {
  throw ErrorApi.sinSesion();
};
const comoCliente = async () => {
  throw ErrorApi.sinPermiso();
};
const post = (cuerpo?: string, tipo = "application/json") =>
  new Request(`http://x/api/admin/resenas/${ID}/aprobar`, { method: "POST", headers: { "content-type": tipo }, body: cuerpo });
const get = () => new Request("http://x/api/admin/resenas");
const CORTE = () => Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
const OK = { resena: { id: ID, estado: "aprobada" as const, revisada_en: "2026-11-10T15:00:00.000Z" } };

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/admin/resenas", () => {
  const base = () => ({}) as never;
  const leerZona = async () => "America/Lima";

  it("401 sin sesión y 403 a un cliente, sin llamar a la lógica", async () => {
    const listar = vi.fn();
    expect((await crearRutaListarResenas({ sesion: sinSesion, listar, base, leerZona })(get())).status).toBe(401);
    expect((await crearRutaListarResenas({ sesion: comoCliente, listar, base, leerZona })(get())).status).toBe(403);
    expect(listar).not.toHaveBeenCalled();
  });

  it("200 con la cola, sin caché", async () => {
    const cola = [{ id: ID, revision: "h", estrellas: 5, comentario: "Muy bien", cliente: "María Pérez", distrito: "Lince", inicio: "x", creada_en: "y" }];
    const listar = vi.fn(async () => cola);
    const r = await crearRutaListarResenas({ sesion, listar, base, leerZona })(get());
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await r.json()).toEqual({ resenas: cola });
    expect(listar).toHaveBeenCalledWith(expect.anything(), "America/Lima");
  });

  it("un corte y luego éxito reintenta; dos cortes dan 503", async () => {
    const listar = vi.fn().mockRejectedValueOnce(CORTE()).mockResolvedValueOnce([]);
    expect((await crearRutaListarResenas({ sesion, listar, base, leerZona, esperaReintentoMs: 0 })(get())).status).toBe(200);
    const siempre = vi.fn().mockRejectedValue(CORTE());
    expect((await crearRutaListarResenas({ sesion, listar: siempre, base, leerZona, esperaReintentoMs: 0 })(get())).status).toBe(503);
  });
});

describe.each([
  ["aprobar", crearRutaAprobar, "aprobada"],
  ["rechazar", crearRutaRechazar, "rechazada"],
] as const)("POST /api/admin/resenas/[id]/%s", (_nombre, crear, decision) => {
  it("401 sin sesión", async () => {
    const accion = vi.fn();
    expect((await crear({ sesion: sinSesion, accion })(post(), contexto())).status).toBe(401);
    expect(accion).not.toHaveBeenCalled();
  });

  it("403 a un cliente SIN llamar a la lógica ni revalidar", async () => {
    const accion = vi.fn();
    const revalidar = vi.fn();
    expect((await crear({ sesion: comoCliente, accion, revalidar })(post(), contexto())).status).toBe(403);
    expect(accion).not.toHaveBeenCalled();
    expect(revalidar).not.toHaveBeenCalled();
  });

  it("404 para un id abc", async () => {
    const accion = vi.fn();
    expect((await crear({ sesion, accion })(post(), contexto("abc"))).status).toBe(404);
    expect(accion).not.toHaveBeenCalled();
  });

  it("415 si llega un cuerpo que no es JSON", async () => {
    expect((await crear({ sesion, accion: vi.fn() })(post("x=1", "text/plain"), contexto())).status).toBe(415);
  });

  it("200 con la decisión, el id y el administrador de la sesión", async () => {
    const accion = vi.fn(async () => ({ resena: { ...OK.resena, estado: decision } }));
    const r = await crear({ sesion, accion, revalidar: () => {} })(post(), contexto());
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(accion).toHaveBeenCalledWith({ id: ID, decision, adminId: "adm" });
  });

  it("pasa la huella del cuerpo (revision) a la lógica", async () => {
    const accion = vi.fn(async () => OK);
    await crear({ sesion, accion, revalidar: () => {} })(post(JSON.stringify({ revision: "abc123" })), contexto());
    expect(accion).toHaveBeenCalledWith({ id: ID, decision, adminId: "adm", revision: "abc123" });
  });

  it("409 y 404 de la lógica salen tal cual y no revalidan", async () => {
    const revalidar = vi.fn();
    const yaRevisada = vi.fn(async () => {
      throw ErrorApi.conflicto("Esa reseña ya fue revisada: está aprobada.");
    });
    expect((await crear({ sesion, accion: yaRevisada, revalidar })(post(), contexto())).status).toBe(409);
    const inexistente = vi.fn(async () => {
      throw ErrorApi.noEncontrado("No encontramos esa reseña.");
    });
    expect((await crear({ sesion, accion: inexistente, revalidar })(post(), contexto())).status).toBe(404);
    expect(revalidar).not.toHaveBeenCalled();
  });

  it("un corte y luego éxito reintenta; dos cortes dan 503", async () => {
    const accion = vi.fn().mockRejectedValueOnce(CORTE()).mockResolvedValueOnce(OK);
    expect((await crear({ sesion, accion, revalidar: () => {}, esperaReintentoMs: 0 })(post(), contexto())).status).toBe(200);
    const siempre = vi.fn().mockRejectedValue(CORTE());
    expect((await crear({ sesion, accion: siempre, esperaReintentoMs: 0 })(post(), contexto())).status).toBe(503);
  });
});

describe("revalidación de la landing", () => {
  it("se pide al aprobar y no al rechazar", async () => {
    const revalidar = vi.fn();
    await crearRutaAprobar({ sesion, accion: vi.fn(async () => OK), revalidar })(post(), contexto());
    expect(revalidar).toHaveBeenCalledTimes(1);
    const otra = vi.fn();
    await crearRutaRechazar({ sesion, accion: vi.fn(async () => ({ resena: { ...OK.resena, estado: "rechazada" as const } })), revalidar: otra })(post(), contexto());
    expect(otra).not.toHaveBeenCalled();
  });

  it("un error de revalidatePath no rompe la aprobación", async () => {
    const revalidar = vi.fn(() => {
      throw new Error("revalidatePath falló");
    });
    const r = await crearRutaAprobar({ sesion, accion: vi.fn(async () => OK), revalidar })(post(), contexto());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(OK);
    expect(revalidar).toHaveBeenCalled();
  });

  it("la revalidación por defecto pide / y /preguntas", async () => {
    vi.resetModules();
    const revalidatePath = vi.fn();
    vi.doMock("next/cache", () => ({ revalidatePath }));
    const { revalidarLanding } = await import("./rutas-admin");
    revalidarLanding();
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual(["/", "/preguntas"]);
    vi.doUnmock("next/cache");
  });
});
