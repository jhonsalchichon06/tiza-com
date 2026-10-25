import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../errores";
import type { Usuario } from "../sesion";
import type { RespuestaReenvio } from "./reenvio";
import { crearRutaPagos } from "./rutas";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const USUARIO: Usuario = { id: "u1", correo: "u1@tiza.test", nombre: "Ana", celular: "987654321", rol: "cliente" };
const AHORA = new Date("2026-11-02T15:00:00Z");
const RESPUESTA: RespuestaReenvio = {
  pago: { id: "p2", concepto: "membresia_y_reserva", monto: 33666, metodo: "yape", estado: "pendiente", reemplaza_a: "p1" },
  reserva: null,
};
const peticion = (cuerpo: unknown = { x: 1 }, tipo = "application/json") =>
  new Request("http://localhost/api/pagos", { method: "POST", headers: { "content-type": tipo }, body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) });
const ruta = (reenviar: unknown, sesion = async () => USUARIO) => crearRutaPagos({ sesion, reenviar: reenviar as never, ahora: () => AHORA, esperaReintentoMs: 1 });
const corte = () => Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/pagos", () => {
  it("sin sesión → 401 y no llama a la lógica", async () => {
    const reenviar = vi.fn();
    const r = await ruta(reenviar, async () => { throw ErrorApi.sinSesion(); })(peticion());
    expect(r.status).toBe(401);
    expect(reenviar).not.toHaveBeenCalled();
  });

  it("text/plain → 415", async () => {
    const reenviar = vi.fn();
    const r = await ruta(reenviar)(peticion("{}", "text/plain"));
    expect(r.status).toBe(415);
    expect(reenviar).not.toHaveBeenCalled();
  });

  it("un JSON ilegible → 422", async () => {
    const r = await ruta(vi.fn())(peticion("{no"));
    expect(r.status).toBe(422);
  });

  it("201 con la respuesta, cabeceras privadas, y llama con el usuario y el cuerpo", async () => {
    const reenviar = vi.fn(async () => RESPUESTA);
    const r = await ruta(reenviar)(peticion({ pago_id: "p1" }));
    expect(r.status).toBe(201);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(await r.json()).toEqual(RESPUESTA);
    expect(reenviar).toHaveBeenCalledWith({ usuario: USUARIO, cuerpo: { pago_id: "p1" }, ahora: AHORA });
  });

  it("los 404, 409 (plazo_vencido) y 422 de la lógica salen con el formato único", async () => {
    for (const [status, codigo] of [[404, "no_encontrado"], [409, "plazo_vencido"], [422, "datos_invalidos"]] as const) {
      const r = await ruta(vi.fn(async () => { throw new ErrorApi(status, codigo, "Mensaje."); }))(peticion());
      expect(r.status).toBe(status);
      expect(await r.json()).toEqual({ error: { codigo, mensaje: "Mensaje." } });
    }
  });

  it("un corte seguido de éxito reintenta una vez; dos cortes → 503", async () => {
    let n = 0;
    const unico = vi.fn(async () => {
      if (++n === 1) throw Object.assign(new Error("Failed query"), { cause: corte() });
      return RESPUESTA;
    });
    expect((await ruta(unico)(peticion())).status).toBe(201);
    expect(unico).toHaveBeenCalledTimes(2);
    const siempre = vi.fn(async () => { throw Object.assign(new Error("Failed query"), { cause: corte() }); });
    expect((await ruta(siempre)(peticion())).status).toBe(503);
  });
});
