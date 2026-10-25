import { beforeEach, describe, expect, it, vi } from "vitest";
import { authEnMemoria, registrarConSesion } from "../../__fixtures__/auth";
import { VALORES_DEL_DISENO } from "../../__fixtures__/configuracion";
import { ErrorApi } from "../../errores";
import type { DependenciasAdmin } from "../../pagos/rutas-admin";
import { requerirAdmin, type Usuario } from "../../sesion";
import { crearRutaApoyo, crearRutaCompletar, crearRutaDisponibilidadAdmin, crearRutaListado, crearRutaMarcarApoyo, crearRutaReasignar, crearRutaReprogramar } from "./rutas";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const ADMIN: Usuario = { id: "admin-1", correo: "admin@tiza.test", nombre: "Admin", celular: "900000000", rol: "admin" };
const ID = "11111111-1111-4111-8111-111111111111";
const contexto = (id = ID) => ({ params: Promise.resolve({ id }) });
const corte = () => Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" });
const envuelto = () => Object.assign(new Error("Failed query"), { cause: corte() });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const post = (cuerpo?: unknown, tipo = "application/json") =>
  new Request("http://localhost/api/admin/reservas/x/accion", {
    method: "POST",
    headers: cuerpo === undefined ? {} : { "content-type": tipo },
    body: cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
const get = (consulta = "") => new Request(`http://localhost/api/admin/reservas${consulta}`);

const base = (extra: Partial<DependenciasAdmin> = {}): DependenciasAdmin => ({
  sesion: async () => ADMIN,
  pasada: async () => ({ reservas: [], membresias: [] }),
  leerConfig: async () => VALORES_DEL_DISENO,
  esperaReintentoMs: 1,
  ...extra,
});

type Ruta = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

// --- Los dos GET ---

const LECTURAS = [
  { nombre: "GET /api/admin/reservas", fabrica: crearRutaListado, resultado: { reservas: [], equipos: [] }, cuerpo: (r: unknown) => r },
  { nombre: "GET /api/admin/apoyo", fabrica: crearRutaApoyo, resultado: [{ id: ID }], cuerpo: (r: unknown) => ({ apoyo: r }) },
] as const;

describe.each(LECTURAS)("$nombre", ({ fabrica, resultado, cuerpo }) => {
  const montar = (extra: Partial<DependenciasAdmin> = {}, listar: unknown = vi.fn(async () => resultado)) => {
    const pasada = vi.fn(async () => ({}));
    const ruta = (fabrica as (d: object) => (r: Request) => Promise<Response>)({ ...base({ pasada }), ...extra, listar, base: () => ({}) });
    return { ruta, pasada, listar: listar as ReturnType<typeof vi.fn> };
  };

  it("200 con la forma, cabeceras privadas, y la pasada corre antes de leer", async () => {
    const orden: string[] = [];
    const pasada = vi.fn(async () => { orden.push("pasada"); });
    const listar = vi.fn(async () => { orden.push("listar"); return resultado; });
    const ruta = (fabrica as (d: object) => (r: Request) => Promise<Response>)({ ...base({ pasada }), listar, base: () => ({}) });
    const r = await ruta(get());
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(await r.json()).toEqual(cuerpo(resultado));
    expect(orden).toEqual(["pasada", "listar"]);
  });

  it("un corte de conexión seguido de éxito se reintenta una vez", async () => {
    let n = 0;
    const { ruta, listar } = montar({}, vi.fn(async () => { if (++n === 1) throw envuelto(); return resultado; }));
    expect((await ruta(get())).status).toBe(200);
    expect(listar).toHaveBeenCalledTimes(2);
  });

  it("dos cortes seguidos → 503", async () => {
    const { ruta } = montar({}, vi.fn(async () => { throw envuelto(); }));
    const r = await ruta(get());
    expect(r.status).toBe(503);
    expect((await r.json()).error.codigo).toBe("no_disponible");
  });

  it("dos cortes en la pasada → 503 sin leer", async () => {
    const { ruta, listar } = montar({ pasada: async () => { throw corte(); } });
    expect((await ruta(get())).status).toBe(503);
    expect(listar).not.toHaveBeenCalled();
  });

  it("sin sesión → 401 con el formato único, sin pasada ni lectura", async () => {
    const { ruta, pasada, listar } = montar({ sesion: async () => { throw ErrorApi.sinSesion(); } });
    const r = await ruta(get());
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: { codigo: "sin_sesion", mensaje: "Inicia sesión para continuar." } });
    expect(pasada).not.toHaveBeenCalled();
    expect(listar).not.toHaveBeenCalled();
  });

  it("un cliente → 403 con la sesión real, sin pasada ni lectura", async () => {
    const { auth } = authEnMemoria();
    const cabeceras = await registrarConSesion(auth);
    const { ruta, pasada, listar } = montar({ sesion: () => requerirAdmin(cabeceras, auth) });
    const r = await ruta(new Request("http://localhost/api/admin/x", { headers: cabeceras }));
    expect(r.status).toBe(403);
    expect(pasada).not.toHaveBeenCalled();
    expect(listar).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/reservas: filtro", () => {
  it("entrega el estado al listado y lo configura con la configuración vigente", async () => {
    const listar = vi.fn(async () => ({ reservas: [], equipos: [] }));
    const ruta = crearRutaListado({ ...base(), listar: listar as never, base: () => ({}) as never });
    await ruta(get("?estado=por_completar"));
    expect(listar).toHaveBeenCalledWith({}, { estado: "por_completar" }, VALORES_DEL_DISENO);
    await ruta(get());
    expect(listar).toHaveBeenLastCalledWith({}, { estado: null }, VALORES_DEL_DISENO);
  });

  it("estado=otro → 422 con el formato único", async () => {
    const listar = vi.fn(async () => { throw ErrorApi.invalido("El estado debe ser uno de: …"); });
    const ruta = crearRutaListado({ ...base(), listar: listar as never, base: () => ({}) as never });
    const r = await ruta(get("?estado=otro"));
    expect(r.status).toBe(422);
    expect((await r.json()).error.codigo).toBe("datos_invalidos");
  });
});

// --- Los tres POST ---

const ACCIONES = [
  { nombre: "completar", fabrica: crearRutaCompletar, resultado: { reserva: { id: ID, estado: "completada" } }, cuerpoValido: undefined },
  { nombre: "reasignar", fabrica: crearRutaReasignar, resultado: { reserva: { id: ID, estado: "confirmada", equipo_id: 2 } }, cuerpoValido: { equipo_id: 2 } },
  { nombre: "marcar apoyo", fabrica: crearRutaMarcarApoyo, resultado: { reserva: { id: ID, apoyo_estado: "coordinado", apoyo_nota: "x" } }, cuerpoValido: { nota: "x" } },
  { nombre: "reprogramar", fabrica: crearRutaReprogramar, resultado: { reserva: { id: ID, estado: "confirmada", inicio: "2026-11-06T10:00:00-05:00", reprogramada_por: "admin-1" } }, cuerpoValido: { inicio: "2026-11-06T15:00:00Z" } },
] as const;

describe.each(ACCIONES)("POST $nombre", ({ fabrica, resultado, cuerpoValido }) => {
  const montar = (extra: Partial<DependenciasAdmin> = {}, accion: unknown = vi.fn(async () => resultado)) => {
    const pasada = vi.fn(async () => ({}));
    const ruta = (fabrica as (d: object) => Ruta)({ ...base({ pasada }), ...extra, accion });
    return { ruta, pasada, accion: accion as ReturnType<typeof vi.fn> };
  };

  it("200 con la reserva, cabeceras privadas, y la pasada corre antes que la lógica", async () => {
    const orden: string[] = [];
    const pasada = vi.fn(async () => { orden.push("pasada"); });
    const accion = vi.fn(async () => { orden.push("accion"); return resultado; });
    const ruta = (fabrica as (d: object) => Ruta)({ ...base({ pasada }), accion });
    const r = await ruta(post(cuerpoValido), contexto());
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(await r.json()).toEqual(resultado);
    expect(orden).toEqual(["pasada", "accion"]);
    expect(accion).toHaveBeenCalledWith(expect.objectContaining({ reservaId: ID }));
  });

  it("«abc» → 404 sin llamar a la lógica, y un uuid inexistente → 404 de la lógica", async () => {
    const { ruta, accion } = montar();
    const r = await ruta(post(cuerpoValido), contexto("abc"));
    expect(r.status).toBe(404);
    expect((await r.json()).error.codigo).toBe("no_encontrado");
    expect(accion).not.toHaveBeenCalled();
    const inexistente = montar({}, vi.fn(async () => { throw ErrorApi.noEncontrado("No encontramos esa reserva."); }));
    expect((await inexistente.ruta(post(cuerpoValido), contexto())).status).toBe(404);
  });

  it("un cuerpo text/plain → 415 sin llamar a la lógica", async () => {
    const { ruta, accion } = montar();
    expect((await ruta(post("hola", "text/plain"), contexto())).status).toBe(415);
    expect(accion).not.toHaveBeenCalled();
  });

  it("409 y 422 de la lógica salen con el formato único", async () => {
    for (const [status, codigo] of [[409, "conflicto"], [422, "datos_invalidos"]] as const) {
      const { ruta } = montar({}, vi.fn(async () => { throw new ErrorApi(status, codigo, "Mensaje claro."); }));
      const r = await ruta(post(cuerpoValido), contexto());
      expect(r.status).toBe(status);
      expect(await r.json()).toEqual({ error: { codigo, mensaje: "Mensaje claro." } });
    }
  });

  it("la pasada corre antes aunque la lógica falle", async () => {
    const { ruta, pasada } = montar({}, vi.fn(async () => { throw ErrorApi.conflicto("No."); }));
    expect((await ruta(post(cuerpoValido), contexto())).status).toBe(409);
    expect(pasada).toHaveBeenCalledTimes(1);
  });

  it("un corte seguido de éxito reintenta y responde 200; dos cortes → 503", async () => {
    let n = 0;
    const una = montar({}, vi.fn(async () => { if (++n === 1) throw envuelto(); return resultado; }));
    expect((await una.ruta(post(cuerpoValido), contexto())).status).toBe(200);
    expect(una.accion).toHaveBeenCalledTimes(2);
    const dos = montar({}, vi.fn(async () => { throw envuelto(); }));
    expect((await dos.ruta(post(cuerpoValido), contexto())).status).toBe(503);
  });

  it("sin sesión → 401 y un cliente → 403, sin llamar a la pasada ni a la lógica", async () => {
    const sin = montar({ sesion: async () => { throw ErrorApi.sinSesion(); } });
    expect((await sin.ruta(post(cuerpoValido), contexto())).status).toBe(401);
    const { auth } = authEnMemoria();
    const cabeceras = await registrarConSesion(auth);
    const cliente = montar({ sesion: () => requerirAdmin(cabeceras, auth) });
    const r = await cliente.ruta(new Request("http://localhost/x", { method: "POST", headers: cabeceras }), contexto());
    expect(r.status).toBe(403);
    for (const m of [sin, cliente]) {
      expect(m.pasada).not.toHaveBeenCalled();
      expect(m.accion).not.toHaveBeenCalled();
    }
  });
});

describe("el cuerpo llega a la lógica", () => {
  it("reasignar entrega el cuerpo JSON y apoyo entrega la nota", async () => {
    const accion = vi.fn(async () => ({}));
    await crearRutaReasignar({ ...base(), accion: accion as never })(post({ equipo_id: 2 }), contexto());
    expect(accion).toHaveBeenCalledWith({ reservaId: ID, cuerpo: { equipo_id: 2 } });
    const apoyo = vi.fn(async () => ({}));
    await crearRutaMarcarApoyo({ ...base(), accion: apoyo as never })(post({ nota: "Rosa" }), contexto());
    expect(apoyo).toHaveBeenCalledWith({ reservaId: ID, cuerpo: { nota: "Rosa" } });
  });

  it("completar no necesita cuerpo ni Content-Type", async () => {
    const accion = vi.fn(async () => ({ reserva: { id: ID, estado: "completada" } }));
    const r = await crearRutaCompletar({ ...base(), accion: accion as never })(post(), contexto());
    expect(r.status).toBe(200);
    expect(accion).toHaveBeenCalledWith({ reservaId: ID });
  });

  it("un JSON ilegible → 422", async () => {
    const accion = vi.fn(async () => ({}));
    const r = await crearRutaReasignar({ ...base(), accion: accion as never })(post("{no es json"), contexto());
    expect(r.status).toBe(422);
    expect(accion).not.toHaveBeenCalled();
  });
});

describe("POST reprogramar: lo que recibe la lógica", () => {
  it("entrega el cuerpo, el id del administrador de la sesión y el instante de la petición", async () => {
    const accion = vi.fn(async () => ({}));
    const ahora = new Date("2026-11-02T15:00:00Z");
    await crearRutaReprogramar({ ...base(), accion: accion as never, ahora: () => ahora })(post({ inicio: "2026-11-06T15:00:00Z" }), contexto());
    expect(accion).toHaveBeenCalledWith({ reservaId: ID, cuerpo: { inicio: "2026-11-06T15:00:00Z" }, adminId: "admin-1", ahora });
  });
});

describe("GET /api/admin/reservas/[id]/disponibilidad", () => {
  const DIA = { fecha: "2026-11-06", atendido: true, horarios: [{ hora: "08:00", inicio: "2026-11-06T08:00:00-05:00", disponible: false, motivo: "sin_cupo" }] };
  const peticion = (consulta = "?fecha=2026-11-06") => new Request(`http://localhost/api/admin/reservas/x/disponibilidad${consulta}`);
  const montar = (extra: Partial<DependenciasAdmin> = {}, consultar: unknown = vi.fn(async () => DIA)) => {
    const pasada = vi.fn(async () => ({}));
    const ahora = new Date("2026-11-02T15:00:00Z");
    return { ruta: crearRutaDisponibilidadAdmin({ ...base({ pasada }), ...extra, consultar: consultar as never, ahora: () => ahora }), pasada, consultar: consultar as ReturnType<typeof vi.fn>, ahora };
  };

  it("200 con los horarios, cabeceras privadas, y entrega id, fecha e instante a la consulta tras la pasada", async () => {
    const { ruta, pasada, consultar, ahora } = montar();
    const r = await ruta(peticion(), contexto());
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(await r.json()).toEqual(DIA);
    expect(pasada).toHaveBeenCalledTimes(1);
    expect(consultar).toHaveBeenCalledWith({ reservaId: ID, fecha: "2026-11-06", ahora });
  });

  it("«abc» → 404 sin consultar; reserva inexistente → 404; fecha 2026-02-30 → 422 (de la lógica)", async () => {
    const m = montar();
    expect((await m.ruta(peticion(), contexto("abc"))).status).toBe(404);
    expect(m.consultar).not.toHaveBeenCalled();
    const sin = montar({}, vi.fn(async () => { throw ErrorApi.noEncontrado("No encontramos esa reserva."); }));
    expect((await sin.ruta(peticion(), contexto())).status).toBe(404);
    const mala = montar({}, vi.fn(async () => { throw ErrorApi.invalido("La fecha no es válida."); }));
    expect((await mala.ruta(peticion("?fecha=2026-02-30"), contexto())).status).toBe(422);
  });

  it("sin sesión → 401 y un cliente → 403, sin pasada ni consulta", async () => {
    const sin = montar({ sesion: async () => { throw ErrorApi.sinSesion(); } });
    expect((await sin.ruta(peticion(), contexto())).status).toBe(401);
    const { auth } = authEnMemoria();
    const cabeceras = await registrarConSesion(auth);
    const cliente = montar({ sesion: () => requerirAdmin(cabeceras, auth) });
    expect((await cliente.ruta(new Request("http://localhost/x?fecha=2026-11-06", { headers: cabeceras }), contexto())).status).toBe(403);
    for (const m of [sin, cliente]) {
      expect(m.pasada).not.toHaveBeenCalled();
      expect(m.consultar).not.toHaveBeenCalled();
    }
  });

  it("un corte seguido de éxito reintenta; dos cortes → 503", async () => {
    let n = 0;
    const una = montar({}, vi.fn(async () => { if (++n === 1) throw envuelto(); return DIA; }));
    expect((await una.ruta(peticion(), contexto())).status).toBe(200);
    expect(una.consultar).toHaveBeenCalledTimes(2);
    const dos = montar({}, vi.fn(async () => { throw envuelto(); }));
    expect((await dos.ruta(peticion(), contexto())).status).toBe(503);
  });
});
