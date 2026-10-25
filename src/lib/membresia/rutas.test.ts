import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../errores";
import type { Usuario } from "../sesion";
import type { renovarMembresia, RespuestaRenovar } from "./renovar";
import { crearRutaRenovar } from "./rutas";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const USUARIO: Usuario = { id: "u1", correo: "u1@tiza.test", nombre: "Ana", celular: "987654321", rol: "cliente" };
const sesionOk = async () => USUARIO;
const sinSesion = async () => {
  throw ErrorApi.sinSesion();
};
const RESPUESTA: RespuestaRenovar = {
  membresia: { id: "m1", estado: "pendiente", monto: 26700 },
  pago: { id: "p1", concepto: "membresia", monto: 26700, metodo: "yape", estado: "pendiente" },
  plan: { meses: 3, monto: 26700 },
};

const peticion = (cuerpo: unknown = { metodo: "yape", comprobante: "comprobantes/u1/a.jpg" }, tipo = "application/json") =>
  new Request("http://localhost/api/membresia/renovar", {
    method: "POST",
    headers: { "content-type": tipo },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
const ruta = (renovar: typeof renovarMembresia, sesion = sesionOk) => crearRutaRenovar({ sesion, renovar, ahora: () => new Date("2026-12-10T15:00:00Z"), esperaReintentoMs: 1 });
const corte = () => Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/membresia/renovar", () => {
  it("sin sesión: 401 y no renueva", async () => {
    const renovar = vi.fn();
    const r = await ruta(renovar as never, sinSesion)(peticion());
    expect(r.status).toBe(401);
    expect((await r.json()).error.codigo).toBe("sin_sesion");
    expect(renovar).not.toHaveBeenCalled();
  });

  it("sin application/json: 415 y no renueva", async () => {
    const renovar = vi.fn();
    const r = await ruta(renovar as never)(peticion("metodo=yape", "text/plain"));
    expect(r.status).toBe(415);
    expect(renovar).not.toHaveBeenCalled();
  });

  it("JSON roto: 422", async () => {
    const renovar = vi.fn();
    const r = await ruta(renovar as never)(peticion("{no es json"));
    expect(r.status).toBe(422);
    expect(renovar).not.toHaveBeenCalled();
  });

  it("201 con la membresía, el pago y el plan; pasa al usuario de la sesión y no se guarda en caché", async () => {
    const renovar = vi.fn(async () => RESPUESTA);
    const r = await ruta(renovar as never)(peticion());
    expect(r.status).toBe(201);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await r.json()).toEqual(RESPUESTA);
    expect(renovar).toHaveBeenCalledWith(expect.objectContaining({ usuario: USUARIO, cuerpo: { metodo: "yape", comprobante: "comprobantes/u1/a.jpg" } }));
  });

  it("un 409 de la renovación sale con su código y mensaje", async () => {
    const renovar = vi.fn(async () => {
      throw new ErrorApi(409, "renovacion_no_aplica", "Tu membresía sigue vigente.");
    });
    const r = await ruta(renovar as never)(peticion());
    expect(r.status).toBe(409);
    expect((await r.json()).error).toEqual({ codigo: "renovacion_no_aplica", mensaje: "Tu membresía sigue vigente." });
    expect(renovar).toHaveBeenCalledTimes(1);
  });

  it("un corte de conexión se reintenta una vez y la segunda vez responde 201", async () => {
    const renovar = vi.fn().mockRejectedValueOnce(corte()).mockResolvedValueOnce(RESPUESTA);
    const r = await ruta(renovar as never)(peticion());
    expect(r.status).toBe(201);
    expect(renovar).toHaveBeenCalledTimes(2);
  });

  it("si el corte se repite: 503 Inténtalo en unos segundos", async () => {
    const renovar = vi.fn().mockRejectedValue(corte());
    const r = await ruta(renovar as never)(peticion());
    expect(r.status).toBe(503);
    expect((await r.json()).error.mensaje).toBe("Inténtalo en unos segundos.");
    expect(renovar).toHaveBeenCalledTimes(2);
  });
});
