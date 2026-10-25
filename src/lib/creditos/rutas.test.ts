import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../errores";
import type { Usuario } from "../sesion";
import { crearEjecutorDoble } from "./__doble__";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

import { crearRutaCreditos, crearRutaCreditosAdmin, crearRutaCreditosAdminDetalle, respuestaMetodoNoPermitido } from "./rutas";

const ANA: Usuario = { id: "ana", correo: "ana@tiza.test", nombre: "Ana", celular: "987654321", rol: "cliente" };
const BETO: Usuario = { id: "beto", correo: "beto@tiza.test", nombre: "Beto", celular: "987654322", rol: "cliente" };
const ADMIN: Usuario = { id: "adm", correo: "admin@tiza.test", nombre: "Admin", celular: "987654323", rol: "admin" };
const VENCE = new Date("2027-02-02T15:00:00Z");
const config = async () => ({ horario_atencion: { zona: "America/Lima" } }) as never;
const sinPasada = async () => undefined;
const sinSesion = async () => {
  throw ErrorApi.sinSesion();
};
const soloAdmin = async () => {
  throw ErrorApi.sinPermiso();
};
const corte = () => Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("Connection terminated"), { code: "ECONNRESET" }) });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const get = (url = "http://localhost/api/creditos") => new Request(url);

// Cola de resultados de `leerCreditos`: saldo, lotes y movimientos.
const colaDe = (horas: string) => [
  [{ saldo: horas, proximo: VENCE, proximo_horas: "1.5" }],
  [{ id: "l1", horas_iniciales: "4", horas_disponibles: horas, creado_en: VENCE, vence_en: VENCE, vigente: true, reserva_origen_id: "r0", origen_inicio: VENCE, origen_cancelada_en: VENCE }],
  [],
];

describe("GET /api/creditos", () => {
  it("401 sin sesión y no lee nada", async () => {
    const { tx, sentencias } = crearEjecutorDoble();
    const GET = crearRutaCreditos({ sesion: sinSesion, base: () => tx, leerConfig: config, pasada: sinPasada });
    const r = await GET(get());
    expect(r.status).toBe(401);
    expect(sentencias).toHaveLength(0);
  });

  it("200 con la forma y sin caché", async () => {
    const { tx } = crearEjecutorDoble(colaDe("2.5"));
    const GET = crearRutaCreditos({ sesion: async () => ANA, base: () => tx, leerConfig: config, pasada: sinPasada });
    const r = await GET(get());
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    const json = await r.json();
    expect(Object.keys(json).sort()).toEqual(["lotes", "movimientos", "proximo_vencimiento", "saldo_horas"]);
    expect(json.saldo_horas).toBe(2.5);
    expect(json.proximo_vencimiento).toEqual({ horas: 1.5, vence_en: "2027-02-02T10:00:00-05:00" });
  });

  it("usa el usuario de la sesión y no mezcla clientes (ignora cualquier usuario_id de la petición)", async () => {
    const a = crearEjecutorDoble(colaDe("2"));
    const b = crearEjecutorDoble(colaDe("3"));
    await crearRutaCreditos({ sesion: async () => ANA, base: () => a.tx, leerConfig: config, pasada: sinPasada })(get("http://localhost/api/creditos?usuario_id=beto"));
    await crearRutaCreditos({ sesion: async () => BETO, base: () => b.tx, leerConfig: config, pasada: sinPasada })(get());
    for (const s of a.sentencias) expect(s.params).toContain("ana");
    for (const s of a.sentencias) expect(s.params).not.toContain("beto");
    for (const s of b.sentencias) expect(s.params).toContain("beto");
  });

  it("ejecuta la pasada de expiración antes de leer", async () => {
    const orden: string[] = [];
    const { tx } = crearEjecutorDoble(colaDe("1"));
    const base = { execute: (q: never) => { orden.push("leer"); return (tx as { execute: (q: never) => Promise<unknown> }).execute(q); } } as never;
    await crearRutaCreditos({ sesion: async () => ANA, base: () => base, leerConfig: config, pasada: async () => { orden.push("pasada"); } })(get());
    expect(orden[0]).toBe("pasada");
  });

  it("un corte de conexión seguido de éxito se reintenta una vez", async () => {
    const { tx } = crearEjecutorDoble(colaDe("1"));
    const pasada = vi.fn().mockRejectedValueOnce(corte()).mockResolvedValueOnce(undefined);
    const r = await crearRutaCreditos({ sesion: async () => ANA, base: () => tx, leerConfig: config, pasada, esperaReintentoMs: 1 })(get());
    expect(r.status).toBe(200);
    expect(pasada).toHaveBeenCalledTimes(2);
  });

  it("dos cortes dan 503 «Inténtalo en unos segundos.»", async () => {
    const pasada = vi.fn(async () => { throw corte(); });
    const r = await crearRutaCreditos({ sesion: async () => ANA, base: () => crearEjecutorDoble().tx, leerConfig: config, pasada, esperaReintentoMs: 1 })(get());
    expect(r.status).toBe(503);
    expect((await r.json()).error.mensaje).toBe("Inténtalo en unos segundos.");
    expect(pasada).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/admin/creditos", () => {
  const filaCliente = { usuario_id: "ana", nombre: "Ana", correo: "ana@tiza.test", saldo: "2.5", proximo: VENCE, lotes: "1" };

  it("401 sin sesión y 403 con un cliente, sin leer datos", async () => {
    for (const [sesion, estado] of [[sinSesion, 401], [soloAdmin, 403]] as const) {
      const { tx, sentencias } = crearEjecutorDoble();
      const pasada = vi.fn();
      const r = await crearRutaCreditosAdmin({ sesion, base: () => tx, leerZona: config, pasada })(get("http://localhost/api/admin/creditos"));
      expect(r.status).toBe(estado);
      expect(sentencias).toHaveLength(0);
      expect(pasada).not.toHaveBeenCalled();
    }
  });

  it("200 con la lista de clientes", async () => {
    const { tx } = crearEjecutorDoble([[filaCliente]]);
    const r = await crearRutaCreditosAdmin({ sesion: async () => ADMIN, base: () => tx, leerZona: config, pasada: sinPasada })(get("http://localhost/api/admin/creditos"));
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await r.json()).clientes).toEqual([{ usuario_id: "ana", nombre: "Ana", correo: "ana@tiza.test", saldo_horas: 2.5, proximo_vencimiento: "2027-02-02T10:00:00-05:00", lotes: 1 }]);
  });

  it("detalle: 200 con el cliente y sus lotes", async () => {
    const { tx } = crearEjecutorDoble([[{ id: "ana", nombre: "Ana", correo: "ana@tiza.test" }], ...colaDe("2.5")]);
    const GET = crearRutaCreditosAdminDetalle({ sesion: async () => ADMIN, base: () => tx, leerZona: config, pasada: sinPasada });
    const r = await GET(get("http://localhost/api/admin/creditos/ana"), { params: Promise.resolve({ usuarioId: "ana" }) });
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.cliente.usuario_id).toBe("ana");
    expect(json.lotes).toHaveLength(1);
  });

  it("detalle: 404 si el cliente no existe, 403 y 401 antes de leer", async () => {
    const { tx } = crearEjecutorDoble([[]]);
    const ctx = { params: Promise.resolve({ usuarioId: "nadie" }) };
    expect((await crearRutaCreditosAdminDetalle({ sesion: async () => ADMIN, base: () => tx, leerZona: config, pasada: sinPasada })(get(), ctx)).status).toBe(404);
    const otro = crearEjecutorDoble();
    expect((await crearRutaCreditosAdminDetalle({ sesion: soloAdmin, base: () => otro.tx, leerZona: config, pasada: sinPasada })(get(), ctx)).status).toBe(403);
    expect((await crearRutaCreditosAdminDetalle({ sesion: sinSesion, base: () => otro.tx, leerZona: config, pasada: sinPasada })(get(), ctx)).status).toBe(401);
    expect(otro.sentencias).toHaveLength(0);
  });

  it("cualquier método distinto de GET responde 405 con Allow: GET", async () => {
    const r = await respuestaMetodoNoPermitido();
    expect(r.status).toBe(405);
    expect(r.headers.get("Allow")).toBe("GET");
    expect((await r.json()).error.codigo).toBe("metodo_no_permitido");
  });
});

describe("las rutas de app/api/**/creditos exportan solo GET y los métodos que responden 405", () => {
  it("POST, PUT, PATCH y DELETE de /api/admin/creditos son el 405", async () => {
    const ruta = await import("../../../app/api/admin/creditos/route");
    for (const metodo of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      expect((await ruta[metodo](new Request("http://localhost/api/admin/creditos", { method: metodo }))).status).toBe(405);
    }
    const detalle = await import("../../../app/api/admin/creditos/[usuarioId]/route");
    expect((await detalle.POST(new Request("http://localhost/x", { method: "POST" }))).status).toBe(405);
  });
});
