import { beforeEach, describe, expect, it, vi } from "vitest";
import { authEnMemoria, registrarConSesion } from "../__fixtures__/auth";
import { ErrorApi } from "../errores";
import { requerirAdmin, type Usuario } from "../sesion";
import { crearRutaRegistrarFotos } from "./rutas";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const ADMIN: Usuario = { id: "admin-1", correo: "admin@tiza.test", nombre: "Admin", celular: "900000000", rol: "admin" };
const ID = "11111111-1111-4111-8111-111111111111";
const contexto = (id = ID) => ({ params: Promise.resolve({ id }) });
const corte = () => Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" });
const envuelto = () => Object.assign(new Error("Failed query"), { cause: corte() });
const CUERPO = { fotos: [{ ruta: `fotos/${ID}/1.webp`, ambiente: "cocina" }] };

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const post = (cuerpo?: unknown, tipo: string | null = "application/json") =>
  new Request(`http://localhost/api/admin/reservas/${ID}/fotos`, {
    method: "POST",
    headers: tipo ? { "content-type": tipo } : {},
    body: cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });

function montar(registrar = vi.fn(async () => [{ id: "f1", ambiente: "cocina" }]), sesion: () => Promise<Usuario> = async () => ADMIN) {
  const ruta = crearRutaRegistrarFotos({ sesion, registrar: registrar as never, esperaReintentoMs: 1 });
  return { ruta, registrar };
}

describe("POST /api/admin/reservas/:id/fotos", () => {
  it("201 con la forma [{ id, ambiente }] y cabeceras privadas; entrega la reserva, el admin y el cuerpo", async () => {
    const { ruta, registrar } = montar();
    const r = await ruta(post(CUERPO), contexto());
    expect(r.status).toBe(201);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(await r.json()).toEqual([{ id: "f1", ambiente: "cocina" }]);
    expect(registrar).toHaveBeenCalledWith({ usuario: ADMIN, reservaId: ID, cuerpo: CUERPO });
  });

  it("sin sesión: 401 con el formato único y sin ejecutar la lógica", async () => {
    const { ruta, registrar } = montar(undefined, async () => { throw ErrorApi.sinSesion(); });
    const r = await ruta(post(CUERPO), contexto());
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: { codigo: "sin_sesion", mensaje: "Inicia sesión para continuar." } });
    expect(registrar).not.toHaveBeenCalled();
  });

  it("un cliente (sesión real): 403 sin ejecutar la lógica", async () => {
    const { auth } = authEnMemoria();
    const cabeceras = await registrarConSesion(auth);
    const { ruta, registrar } = montar(undefined, () => requerirAdmin(cabeceras, auth));
    const peticion = new Request(`http://localhost/api/admin/reservas/${ID}/fotos`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cabeceras.get("cookie")! },
      body: JSON.stringify(CUERPO),
    });
    const r = await ruta(peticion, contexto());
    expect(r.status).toBe(403);
    expect(registrar).not.toHaveBeenCalled();
  });

  it.each([["text/plain"], [null]])("Content-Type %s: 415", async (tipo) => {
    const { ruta, registrar } = montar();
    const r = await ruta(post(JSON.stringify(CUERPO), tipo), contexto());
    expect(r.status).toBe(415);
    expect(registrar).not.toHaveBeenCalled();
  });

  it("un id «abc»: 404", async () => {
    const { ruta, registrar } = montar();
    const r = await ruta(post(CUERPO), contexto("abc"));
    expect(r.status).toBe(404);
    expect(registrar).not.toHaveBeenCalled();
  });

  it("un cuerpo que no es JSON: 422", async () => {
    const { ruta, registrar } = montar();
    const r = await ruta(post("{no es json"), contexto());
    expect(r.status).toBe(422);
    expect(registrar).not.toHaveBeenCalled();
  });

  it("los errores de la lógica salen con su código (409 por estado)", async () => {
    const { ruta } = montar(vi.fn(async () => { throw ErrorApi.conflicto("Esa reserva está confirmada."); }));
    const r = await ruta(post(CUERPO), contexto());
    expect(r.status).toBe(409);
    expect((await r.json()).error.mensaje).toBe("Esa reserva está confirmada.");
  });

  it("un corte de conexión seguido de éxito se reintenta una vez (también envuelto por Drizzle)", async () => {
    let n = 0;
    const { ruta, registrar } = montar(vi.fn(async () => { if (++n === 1) throw envuelto(); return [{ id: "f1", ambiente: "cocina" }]; }));
    const r = await ruta(post(CUERPO), contexto());
    expect(r.status).toBe(201);
    expect(registrar).toHaveBeenCalledTimes(2);
  });

  it("dos cortes seguidos: 503", async () => {
    const { ruta } = montar(vi.fn(async () => { throw envuelto(); }));
    const r = await ruta(post(CUERPO), contexto());
    expect(r.status).toBe(503);
    expect((await r.json()).error.codigo).toBe("no_disponible");
  });

  it("un 409 no se reintenta", async () => {
    const { ruta, registrar } = montar(vi.fn(async () => { throw ErrorApi.conflicto("Esas fotos ya estaban registradas."); }));
    expect((await ruta(post(CUERPO), contexto())).status).toBe(409);
    expect(registrar).toHaveBeenCalledTimes(1);
  });
});
