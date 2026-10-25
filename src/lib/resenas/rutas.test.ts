import { describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../errores";
import type { Usuario } from "../sesion";
import { MENSAJE_YA_RESENADA } from "./crear";
import { crearRutaEditarResena, crearRutaResena } from "./rutas";

const USUARIO: Usuario = { id: "u1", correo: "a@tiza.test", nombre: "Ana", celular: "999111222", rol: "cliente" };
const ADMIN: Usuario = { ...USUARIO, id: "adm", rol: "admin" };
const ID = "11111111-1111-4111-8111-111111111111";
const sesion = async () => USUARIO;
const sinSesion = async () => {
  throw ErrorApi.sinSesion();
};
const contexto = (id = ID) => ({ params: Promise.resolve({ id }) });
const VALIDO = { estrellas: 5, comentario: "Todo quedó muy limpio, gracias." };
const OK = { id: "r1", estrellas: 5, comentario: VALIDO.comentario, estado: "pendiente" as const };
const peticion = (metodo: "POST" | "PUT", cuerpo?: unknown, tipo: string | null = "application/json") =>
  new Request(`http://x/api/reservas/${ID}/resena`, {
    method: metodo,
    headers: tipo ? { "content-type": tipo } : {},
    body: cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
const CORTE = () => Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });

describe.each([
  ["POST", crearRutaResena, 201],
  ["PUT", crearRutaEditarResena, 200],
] as const)("%s /api/reservas/[id]/resena", (metodo, crear, exito) => {
  it("401 sin sesión y no llama a la lógica", async () => {
    const accion = vi.fn();
    expect((await crear({ sesion: sinSesion, accion })(peticion(metodo, VALIDO), contexto())).status).toBe(401);
    expect(accion).not.toHaveBeenCalled();
  });

  it("415 sin application/json", async () => {
    const accion = vi.fn();
    const r = await crear({ sesion, accion })(peticion(metodo, "x=1", "text/plain"), contexto());
    expect(r.status).toBe(415);
    expect(accion).not.toHaveBeenCalled();
  });

  it("404 con un id abc, sin llamar a la lógica", async () => {
    const accion = vi.fn();
    expect((await crear({ sesion, accion })(peticion(metodo, VALIDO), contexto("abc"))).status).toBe(404);
    expect(accion).not.toHaveBeenCalled();
  });

  it.each([
    ["estrellas 0", { ...VALIDO, estrellas: 0 }],
    ["estrellas 6", { ...VALIDO, estrellas: 6 }],
    ["estrellas 3.5", { ...VALIDO, estrellas: 3.5 }],
    ["estrellas texto", { ...VALIDO, estrellas: "5" }],
    ["comentario corto", { ...VALIDO, comentario: "corto" }],
    ["comentario largo", { ...VALIDO, comentario: "a".repeat(501) }],
    ["solo espacios", { ...VALIDO, comentario: "            " }],
    ["sin comentario", { estrellas: 5 }],
  ])("422 con %s", async (_n, cuerpo) => {
    const accion = vi.fn();
    const r = await crear({ sesion, accion })(peticion(metodo, cuerpo), contexto());
    expect(r.status).toBe(422);
    expect(accion).not.toHaveBeenCalled();
  });

  it("422 con un JSON roto", async () => {
    expect((await crear({ sesion, accion: vi.fn() })(peticion(metodo, "{no es json"), contexto())).status).toBe(422);
  });

  it(`${exito} con la forma esperada, sin caché y con el usuario de la sesión`, async () => {
    const accion = vi.fn(async () => OK);
    const r = await crear({ sesion, accion })(peticion(metodo, VALIDO), contexto());
    expect(r.status).toBe(exito);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await r.json()).toEqual(OK);
    expect(accion).toHaveBeenCalledWith({ usuarioId: "u1", reservaId: ID, cuerpo: VALIDO });
  });

  it("un administrador que no es dueño recibe el mismo 404", async () => {
    const accion = vi.fn(async () => {
      throw ErrorApi.noEncontrado("No encontramos esa reserva.");
    });
    const r = await crear({ sesion: async () => ADMIN, accion })(peticion(metodo, VALIDO), contexto());
    expect(r.status).toBe(404);
    expect(accion).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: "adm" }));
  });

  it("409 se devuelve con su mensaje", async () => {
    const accion = vi.fn(async () => {
      throw ErrorApi.conflicto(MENSAJE_YA_RESENADA);
    });
    const r = await crear({ sesion, accion })(peticion(metodo, VALIDO), contexto());
    expect(r.status).toBe(409);
    expect((await r.json()).error.mensaje).toBe(MENSAJE_YA_RESENADA);
  });

  it("un corte de conexión seguido de éxito: reintenta una vez", async () => {
    const accion = vi.fn().mockRejectedValueOnce(CORTE()).mockResolvedValueOnce(OK);
    const r = await crear({ sesion, accion, esperaReintentoMs: 0 })(peticion(metodo, VALIDO), contexto());
    expect(r.status).toBe(exito);
    expect(accion).toHaveBeenCalledTimes(2);
  });

  it("el corte envuelto por Drizzle (en cause) también se reintenta", async () => {
    const envuelto = Object.assign(new Error("Failed query"), { cause: CORTE() });
    const accion = vi.fn().mockRejectedValueOnce(envuelto).mockResolvedValueOnce(OK);
    expect((await crear({ sesion, accion, esperaReintentoMs: 0 })(peticion(metodo, VALIDO), contexto())).status).toBe(exito);
  });

  it("dos cortes dan 503", async () => {
    const accion = vi.fn().mockRejectedValue(CORTE());
    const r = await crear({ sesion, accion, esperaReintentoMs: 0 })(peticion(metodo, VALIDO), contexto());
    expect(r.status).toBe(503);
    expect(accion).toHaveBeenCalledTimes(2);
  });

  it("un error inesperado da 500 genérico", async () => {
    const accion = vi.fn().mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await crear({ sesion, accion })(peticion(metodo, VALIDO), contexto());
    expect(r.status).toBe(500);
    expect((await r.json()).error.mensaje).not.toMatch(/boom/);
  });
});
