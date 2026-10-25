import { beforeEach, describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { authEnMemoria, registrarConSesion } from "../__fixtures__/auth";
import { ErrorApi } from "../errores";
import { requerirAdmin, type Usuario } from "../sesion";
import {
  crearRutaAprobar,
  crearRutaCancelarReserva,
  crearRutaDetalleDePago,
  crearRutaListaDePagos,
  crearRutaRechazar,
  type DependenciasAdmin,
} from "./rutas-admin";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const ADMIN: Usuario = { id: "admin-1", correo: "admin@tiza.test", nombre: "Admin", celular: "900000000", rol: "admin" };
const ID = "11111111-1111-4111-8111-111111111111";
const contexto = (id = ID) => ({ params: Promise.resolve({ id }) });
const sesionAdmin = async () => ADMIN;
const corte = () => Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const post = (cuerpo?: unknown, tipo = "application/json") =>
  new Request("http://localhost/api/admin/pagos/x/accion", {
    method: "POST",
    headers: cuerpo === undefined ? {} : { "content-type": tipo },
    body: cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
const get = (consulta = "") => new Request(`http://localhost/api/admin/pagos${consulta}`);

const base = (extra: Partial<DependenciasAdmin> = {}): DependenciasAdmin => ({
  sesion: sesionAdmin,
  pasada: async () => ({ reservas: [], membresias: [] }),
  leerConfig: async () => VALORES_DEL_DISENO,
  esperaReintentoMs: 1,
  ...extra,
});

// Las tres acciones comparten el mismo envoltorio: se prueban con una tabla.
const ACCIONES = [
  { nombre: "aprobar", fabrica: crearRutaAprobar, resultado: { pago: { id: ID, estado: "aprobado" }, membresia: null, reserva: null, nuevo_horario_pendiente: true } },
  { nombre: "rechazar", fabrica: crearRutaRechazar, resultado: { pago: { id: ID, estado: "rechazado" }, reenvio_hasta: "2026-11-09T10:00:00-05:00", reenvio_vigente: true } },
  { nombre: "cancelar reserva", fabrica: crearRutaCancelarReserva, resultado: { reserva: { id: ID, estado: "cancelada", cancelada_por: "admin" } } },
] as const;

describe.each(ACCIONES)("POST $nombre", ({ nombre, fabrica, resultado }) => {
  const montar = (extra: Partial<DependenciasAdmin> = {}, accion: unknown = vi.fn(async () => resultado)) => {
    const pasada = vi.fn(async () => ({}));
    const ruta = (fabrica as (d: object) => (r: Request, c: ReturnType<typeof contexto>) => Promise<Response>)({ ...base({ pasada }), ...extra, accion });
    return { ruta, pasada, accion: accion as ReturnType<typeof vi.fn> };
  };

  it("sin sesión → 401 con el formato único y sin llamar a la pasada ni a la lógica", async () => {
    const { ruta, pasada, accion } = montar({ sesion: async () => { throw ErrorApi.sinSesion(); } });
    const r = await ruta(post(), contexto());
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: { codigo: "sin_sesion", mensaje: "Inicia sesión para continuar." } });
    expect(pasada).not.toHaveBeenCalled();
    expect(accion).not.toHaveBeenCalled();
  });

  it("un cliente → 403 con la sesión real y sin llamar a la lógica", async () => {
    const { auth } = authEnMemoria();
    const cabeceras = await registrarConSesion(auth);
    const { ruta, pasada, accion } = montar({ sesion: () => requerirAdmin(cabeceras, auth) });
    const r = await ruta(new Request("http://localhost/x", { method: "POST", headers: cabeceras }), contexto());
    expect(r.status).toBe(403);
    expect(pasada).not.toHaveBeenCalled();
    expect(accion).not.toHaveBeenCalled();
  });

  it("un id «abc» → 404 sin llamar a la lógica", async () => {
    const { ruta, accion } = montar();
    const r = await ruta(post(), contexto("abc"));
    expect(r.status).toBe(404);
    expect((await r.json()).error.codigo).toBe("no_encontrado");
    expect(accion).not.toHaveBeenCalled();
  });

  it("un cuerpo text/plain → 415", async () => {
    const { ruta, accion } = montar();
    const r = await ruta(post("hola", "text/plain"), contexto());
    expect(r.status).toBe(415);
    expect(accion).not.toHaveBeenCalled();
  });

  it("un JSON ilegible → 422", async () => {
    const { ruta, accion } = montar();
    const r = await ruta(post("{no es json"), contexto());
    expect(r.status).toBe(422);
    expect(accion).not.toHaveBeenCalled();
  });

  it("200 con la forma de la respuesta, cabeceras privadas, y la pasada corre antes que la lógica", async () => {
    const orden: string[] = [];
    const pasada = vi.fn(async () => { orden.push("pasada"); });
    const accion = vi.fn(async () => { orden.push("accion"); return resultado; });
    const ruta = (fabrica as (d: object) => (r: Request, c: ReturnType<typeof contexto>) => Promise<Response>)({ ...base({ pasada }), accion });
    const r = await ruta(post({ motivo: "No coincide" }), contexto());
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(await r.json()).toEqual(resultado);
    expect(orden).toEqual(["pasada", "accion"]);
    expect(accion).toHaveBeenCalledWith(expect.objectContaining({ [nombre === "cancelar reserva" ? "reservaId" : "pagoId"]: ID }) as never);
  });

  it("sin cuerpo también funciona", async () => {
    const { ruta, accion } = montar();
    expect((await ruta(post(), contexto())).status).toBe(200);
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("409 y 422 de la lógica salen con el formato único", async () => {
    for (const [status, codigo] of [[409, "conflicto"], [422, "datos_invalidos"]] as const) {
      const { ruta } = montar({}, vi.fn(async () => { throw new ErrorApi(status, codigo, "Mensaje claro."); }));
      const r = await ruta(post(), contexto());
      expect(r.status).toBe(status);
      expect(await r.json()).toEqual({ error: { codigo, mensaje: "Mensaje claro." } });
    }
  });

  it("la pasada corre antes que la lógica aunque la lógica falle", async () => {
    const { ruta, pasada } = montar({}, vi.fn(async () => { throw ErrorApi.noEncontrado(); }));
    const r = await ruta(post(), contexto());
    expect(r.status).toBe(404);
    expect(pasada).toHaveBeenCalledTimes(1);
  });

  it("un corte de conexión seguido de éxito en la lógica reintenta y responde 200", async () => {
    let n = 0;
    const accion = vi.fn(async () => {
      if (++n === 1) throw Object.assign(new Error("Failed query"), { cause: corte() });
      return resultado;
    });
    const { ruta } = montar({}, accion);
    expect((await ruta(post(), contexto())).status).toBe(200);
    expect(accion).toHaveBeenCalledTimes(2);
  });

  it("dos cortes seguidos → 503", async () => {
    const accion = vi.fn(async () => { throw Object.assign(new Error("Failed query"), { cause: corte() }); });
    const { ruta } = montar({}, accion);
    const r = await ruta(post(), contexto());
    expect(r.status).toBe(503);
    expect((await r.json()).error.codigo).toBe("no_disponible");
  });

  it("dos cortes en la pasada → 503 sin llegar a la lógica", async () => {
    const pasada = vi.fn(async () => { throw corte(); });
    const { ruta, accion } = montar({ pasada });
    expect((await ruta(post(), contexto())).status).toBe(503);
    expect(accion).not.toHaveBeenCalled();
  });
});

describe("el cuerpo llega al rechazo", () => {
  it("entrega el cuerpo JSON a la lógica de rechazar", async () => {
    const accion = vi.fn(async () => ({ pago: {}, reenvio_hasta: null, reenvio_vigente: true }));
    const ruta = crearRutaRechazar({ ...base(), accion: accion as never });
    await ruta(post({ motivo: "No coincide" }), contexto());
    expect(accion).toHaveBeenCalledWith({ admin: ADMIN, pagoId: ID, cuerpo: { motivo: "No coincide" } });
  });
});

describe("GET /api/admin/pagos", () => {
  const filas = [{ pago: { id: ID } }];
  const montar = (extra: Partial<DependenciasAdmin> = {}, listar: unknown = vi.fn(async () => filas)) => {
    const pasada = vi.fn(async () => ({}));
    return { ruta: crearRutaListaDePagos({ ...base({ pasada }), ...extra, listar: listar as never, base: () => ({}) as never }), pasada, listar: listar as ReturnType<typeof vi.fn> };
  };

  it("sin sesión → 401", async () => {
    const { ruta, listar } = montar({ sesion: async () => { throw ErrorApi.sinSesion(); } });
    expect((await ruta(get())).status).toBe(401);
    expect(listar).not.toHaveBeenCalled();
  });

  it("un cliente → 403 sin leer datos", async () => {
    const { auth } = authEnMemoria();
    const cabeceras = await registrarConSesion(auth);
    const { ruta, listar, pasada } = montar({ sesion: () => requerirAdmin(cabeceras, auth) });
    expect((await ruta(new Request("http://localhost/api/admin/pagos", { headers: cabeceras }))).status).toBe(403);
    expect(listar).not.toHaveBeenCalled();
    expect(pasada).not.toHaveBeenCalled();
  });

  it("200 con { pagos }, cabeceras privadas, y la pasada corre antes de leer", async () => {
    const orden: string[] = [];
    const pasada = vi.fn(async () => { orden.push("pasada"); });
    const listar = vi.fn(async () => { orden.push("listar"); return filas; });
    const ruta = crearRutaListaDePagos({ ...base({ pasada }), listar: listar as never, base: () => ({}) as never });
    const r = await ruta(get("?estado=rechazado"));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(await r.json()).toEqual({ pagos: filas });
    expect(orden).toEqual(["pasada", "listar"]);
    expect(listar).toHaveBeenCalledWith({}, { estado: "rechazado" }, VALORES_DEL_DISENO);
  });

  it("estado=otro → 422 de la lógica", async () => {
    const { ruta } = montar({}, vi.fn(async () => { throw ErrorApi.invalido("El estado debe ser pendiente, aprobado o rechazado."); }));
    const r = await ruta(get("?estado=otro"));
    expect(r.status).toBe(422);
  });

  it("un corte seguido de éxito reintenta", async () => {
    let n = 0;
    const { ruta, listar } = montar({}, vi.fn(async () => { if (++n === 1) throw corte(); return filas; }));
    expect((await ruta(get())).status).toBe(200);
    expect(listar).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/admin/pagos/[id]", () => {
  const montar = (extra: Partial<DependenciasAdmin> = {}, detalle: unknown = vi.fn(async () => ({ pago: { id: ID }, coincidencias: { aplica: false, lista: [] } }))) => {
    const pasada = vi.fn(async () => ({}));
    return { ruta: crearRutaDetalleDePago({ ...base({ pasada }), ...extra, detalle: detalle as never, base: () => ({}) as never }), pasada, detalle: detalle as ReturnType<typeof vi.fn> };
  };

  it("sin sesión → 401 y un cliente → 403", async () => {
    const sin = montar({ sesion: async () => { throw ErrorApi.sinSesion(); } });
    expect((await sin.ruta(get(), contexto())).status).toBe(401);
    const { auth } = authEnMemoria();
    const cabeceras = await registrarConSesion(auth);
    const cliente = montar({ sesion: () => requerirAdmin(cabeceras, auth) });
    expect((await cliente.ruta(new Request("http://localhost/x", { headers: cabeceras }), contexto())).status).toBe(403);
    expect(cliente.detalle).not.toHaveBeenCalled();
  });

  it("200 con el detalle y la pasada antes de leer", async () => {
    const { ruta, pasada, detalle } = montar();
    const r = await ruta(get(), contexto());
    expect(r.status).toBe(200);
    expect((await r.json()).coincidencias).toEqual({ aplica: false, lista: [] });
    expect(pasada).toHaveBeenCalledTimes(1);
    expect(detalle).toHaveBeenCalledWith({}, ID, VALORES_DEL_DISENO);
  });

  it("«abc» → 404 y un uuid inexistente → 404", async () => {
    const { ruta, detalle } = montar();
    expect((await ruta(get(), contexto("abc"))).status).toBe(404);
    expect(detalle).not.toHaveBeenCalled();
    const inexistente = montar({}, vi.fn(async () => { throw ErrorApi.noEncontrado("No encontramos ese pago."); }));
    expect((await inexistente.ruta(get(), contexto())).status).toBe(404);
  });
});
