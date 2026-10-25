import { describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../errores";
import type { Usuario } from "../sesion";
import { MENSAJE_RESERVA_NO_ENCONTRADA } from "./detalle";
import { crearRutaDetalleReserva, crearRutaPerfil } from "./rutas";

const USUARIO: Usuario = { id: "u1", correo: "a@tiza.test", nombre: "Ana", celular: "999999999", rol: "cliente" };
const ID = "11111111-1111-4111-8111-111111111111";
const sesion = async () => USUARIO;
const sinSesion = async () => {
  throw ErrorApi.sinSesion();
};
const peticion = (url = "http://x/api/perfil") => new Request(url);
const contexto = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/perfil", () => {
  it("401 sin sesión y no lee nada", async () => {
    const leer = vi.fn();
    const r = await crearRutaPerfil({ sesion: sinSesion, leer })(peticion());
    expect(r.status).toBe(401);
    expect(leer).not.toHaveBeenCalled();
  });

  it("200 con la forma y Cache-Control private, no-store; lee con el usuario de la sesión", async () => {
    const leer = vi.fn(async () => ({ membresia: { estado: "sin_membresia" as const, plazo_vencido: false }, renovacion: { estado: "no_aplica" as const }, avisos: [], proximas: [], historial: [], credito: { saldo_horas: 0, proximo_vencimiento: null as { horas: number; vence_en: string } | null, membresia_vencida: false } }));
    const r = await crearRutaPerfil({ sesion, leer })(peticion());
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(Object.keys(await r.json()).sort()).toEqual(["avisos", "credito", "historial", "membresia", "proximas", "renovacion"]);
    expect(leer).toHaveBeenCalledWith(expect.objectContaining({ usuario: USUARIO }), undefined);
  });

  it("un ErrorApi 503 de la lectura sale con el formato único", async () => {
    const leer = vi.fn(async () => {
      throw ErrorApi.noDisponible();
    });
    const r = await crearRutaPerfil({ sesion, leer })(peticion());
    expect(r.status).toBe(503);
    expect((await r.json()).error.mensaje).toBe("Inténtalo en unos segundos.");
  });
});

describe("GET /api/reservas/[id]", () => {
  const detalle = { id: ID, estado: "confirmada" } as never;

  it("401 sin sesión", async () => {
    const leer = vi.fn();
    const r = await crearRutaDetalleReserva({ sesion: sinSesion, leer })(peticion(), contexto(ID));
    expect(r.status).toBe(401);
    expect(leer).not.toHaveBeenCalled();
  });

  it("200 con el detalle propio; la consulta recibe el id de la sesión y el de la URL", async () => {
    const leer = vi.fn(async () => detalle);
    const r = await crearRutaDetalleReserva({ sesion, leer })(peticion(), contexto(ID));
    expect(r.status).toBe(200);
    expect((await r.json()).reserva.id).toBe(ID);
    expect(leer).toHaveBeenCalledWith(expect.objectContaining({ usuario: USUARIO, reservaId: ID }));
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("404 para una ajena, con el mensaje único", async () => {
    const leer = vi.fn(async () => {
      throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
    });
    const r = await crearRutaDetalleReserva({ sesion, leer })(peticion(), contexto(ID));
    expect(r.status).toBe(404);
    expect((await r.json()).error.mensaje).toBe(MENSAJE_RESERVA_NO_ENCONTRADA);
  });

  it("404 para 'abc' (la función real, sin tocar la base)", async () => {
    const r = await crearRutaDetalleReserva({ sesion })(peticion(), contexto("abc"));
    expect(r.status).toBe(404);
    expect((await r.json()).error.mensaje).toBe(MENSAJE_RESERVA_NO_ENCONTRADA);
  });

  it("un corte de conexión seguido de éxito se reintenta una vez", async () => {
    let n = 0;
    const leer = vi.fn(async () => {
      if (++n === 1) throw Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
      return detalle;
    });
    const r = await crearRutaDetalleReserva({ sesion, leer, esperaReintentoMs: 0 })(peticion(), contexto(ID));
    expect(r.status).toBe(200);
    expect(n).toBe(2);
  });

  it("dos cortes: 503", async () => {
    const leer = vi.fn(async () => {
      throw Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
    });
    const r = await crearRutaDetalleReserva({ sesion, leer, esperaReintentoMs: 0 })(peticion(), contexto(ID));
    expect(r.status).toBe(503);
  });
});
