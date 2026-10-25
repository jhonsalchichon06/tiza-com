import { describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { ErrorApi } from "../errores";
import type { Usuario } from "../sesion";
import { ErrorFueraDePlazo, MENSAJE_RESERVA_NO_ENCONTRADA, type RespuestaCancelacion } from "./cancelar";
import { consultarDisponibilidadDeReserva, type DependenciasDisponibilidadPropia } from "./disponibilidad-propia";
import { crearRutaCancelar, crearRutaDisponibilidadDeReserva, crearRutaReprogramar } from "./rutas-propias";

const USUARIO: Usuario = { id: "u1", correo: "a@tiza.test", nombre: "Ana", celular: "999111222", rol: "cliente" };
const ID = "11111111-1111-4111-8111-111111111111";
const AHORA = new Date("2026-11-02T15:00:00Z");
const sesion = async () => USUARIO;
const sinSesion = async () => {
  throw ErrorApi.sinSesion();
};
const contexto = (id = ID) => ({ params: Promise.resolve({ id }) });
const post = (cuerpo?: unknown, tipo: string | null = "application/json") =>
  new Request(`http://x/api/reservas/${ID}/cancelar`, {
    method: "POST",
    headers: tipo ? { "content-type": tipo } : {},
    body: cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
const CORTE = () => Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
const OK: RespuestaCancelacion = {
  reserva: { id: ID, estado: "cancelada", cancelada_por: "cliente", inicio: "2026-11-05T10:00:00-05:00", fin: "2026-11-05T14:00:00-05:00" },
  limpieza_gratis_conservada: false,
  horas_pagadas: 4,
  pago: { estado: "aprobado" },
  credito: { generado_horas: 4, vence_en: "2027-02-05T10:00:00-05:00", devuelto_horas: 0 },
};

describe("POST /api/reservas/[id]/cancelar", () => {
  it("401 sin sesión y no cancela", async () => {
    const cancelar = vi.fn();
    expect((await crearRutaCancelar({ sesion: sinSesion, cancelar })(post({}), contexto())).status).toBe(401);
    expect(cancelar).not.toHaveBeenCalled();
  });

  it("415 sin application/json y no cancela", async () => {
    const cancelar = vi.fn();
    const r = await crearRutaCancelar({ sesion, cancelar })(post("x=1", "text/plain"), contexto());
    expect(r.status).toBe(415);
    expect(cancelar).not.toHaveBeenCalled();
  });

  it("200 con la forma, sin caché, y recibe el usuario de la sesión y el id de la URL", async () => {
    const cancelar = vi.fn(async () => OK);
    const r = await crearRutaCancelar({ sesion, cancelar, ahora: () => AHORA })(post({}), contexto());
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await r.json()).toEqual(OK);
    expect(cancelar).toHaveBeenCalledWith({ usuario: USUARIO, reservaId: ID, ahora: AHORA });
  });

  it("404 de una reserva ajena (mensaje único)", async () => {
    const cancelar = vi.fn(async () => {
      throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
    });
    const r = await crearRutaCancelar({ sesion, cancelar })(post({}), contexto());
    expect(r.status).toBe(404);
    expect((await r.json()).error.mensaje).toBe(MENSAJE_RESERVA_NO_ENCONTRADA);
  });

  it("409 fuera_de_plazo con el mensaje y el enlace de WhatsApp en el formato de errores", async () => {
    const cancelar = vi.fn(async () => {
      throw new ErrorFueraDePlazo("Solo puedes cancelar hasta 24 horas antes del servicio. Si necesitas ayuda, escríbenos por WhatsApp.", "https://wa.me/51987654321?text=Hola");
    });
    const r = await crearRutaCancelar({ sesion, cancelar })(post({}), contexto());
    expect(r.status).toBe(409);
    expect((await r.json()).error).toEqual({
      codigo: "fuera_de_plazo",
      mensaje: "Solo puedes cancelar hasta 24 horas antes del servicio. Si necesitas ayuda, escríbenos por WhatsApp.",
      whatsapp: "https://wa.me/51987654321?text=Hola",
    });
  });

  it("un corte de conexión seguido de éxito: se reintenta una vez", async () => {
    let n = 0;
    const cancelar = vi.fn(async () => {
      if (++n === 1) throw CORTE();
      return OK;
    });
    const r = await crearRutaCancelar({ sesion, cancelar, esperaReintentoMs: 0 })(post({}), contexto());
    expect(r.status).toBe(200);
    expect(n).toBe(2);
  });

  it("el reintento tras un COMMIT perdido responde 200 por idempotencia (la segunda vez ya está cancelada)", async () => {
    let n = 0;
    const cancelar = vi.fn(async () => {
      if (++n === 1) throw Object.assign(new Error("Failed query"), { cause: CORTE() });
      return OK; // la función real devuelve 200 para una reserva ya cancelada por el cliente
    });
    const r = await crearRutaCancelar({ sesion, cancelar, esperaReintentoMs: 0 })(post({}), contexto());
    expect(r.status).toBe(200);
  });

  it("dos cortes: 503 'Inténtalo en unos segundos.'", async () => {
    const cancelar = vi.fn(async () => {
      throw CORTE();
    });
    const r = await crearRutaCancelar({ sesion, cancelar, esperaReintentoMs: 0 })(post({}), contexto());
    expect(r.status).toBe(503);
    expect((await r.json()).error.mensaje).toBe("Inténtalo en unos segundos.");
  });
});

describe("POST /api/reservas/[id]/reprogramar", () => {
  const OKR = { reserva: { id: ID, estado: "confirmada", inicio: "2026-11-06T10:00:00-05:00", fin: "2026-11-06T14:00:00-05:00", expira_en: null, requiere_apoyo: false, apoyo_estado: null } };

  it("401 y 415", async () => {
    const reprogramar = vi.fn();
    expect((await crearRutaReprogramar({ sesion: sinSesion, reprogramar })(post({}), contexto())).status).toBe(401);
    expect((await crearRutaReprogramar({ sesion, reprogramar })(post("x", "text/plain"), contexto())).status).toBe(415);
    expect(reprogramar).not.toHaveBeenCalled();
  });

  it("JSON ilegible: 422", async () => {
    const r = await crearRutaReprogramar({ sesion, reprogramar: vi.fn() })(post("{no es json"), contexto());
    expect(r.status).toBe(422);
  });

  it("200 y pasa el cuerpo, el id y el usuario", async () => {
    const reprogramar = vi.fn(async () => OKR);
    const r = await crearRutaReprogramar({ sesion, reprogramar, ahora: () => AHORA })(post({ inicio: "2026-11-06T15:00:00Z" }), contexto());
    expect(r.status).toBe(200);
    expect(reprogramar).toHaveBeenCalledWith({ usuario: USUARIO, reservaId: ID, cuerpo: { inicio: "2026-11-06T15:00:00Z" }, ahora: AHORA });
  });

  it("409 fuera_de_plazo con WhatsApp, 409 sin cupo y 404 ajena", async () => {
    const plazo = await crearRutaReprogramar({ sesion, reprogramar: async () => { throw new ErrorFueraDePlazo("m", null); } })(post({}), contexto());
    expect(plazo.status).toBe(409);
    expect((await plazo.json()).error).toEqual({ codigo: "fuera_de_plazo", mensaje: "m", whatsapp: null });
    const cupo = await crearRutaReprogramar({ sesion, reprogramar: async () => { throw ErrorApi.conflicto("Esa hora ya no está disponible. Elige otra hora."); } })(post({}), contexto());
    expect(cupo.status).toBe(409);
    expect((await cupo.json()).error.codigo).toBe("conflicto");
    const ajena = await crearRutaReprogramar({ sesion, reprogramar: async () => { throw ErrorApi.noEncontrado(); } })(post({}), contexto());
    expect(ajena.status).toBe(404);
  });

  it("un corte seguido de éxito se reintenta; dos cortes dan 503", async () => {
    let n = 0;
    const una = await crearRutaReprogramar({ sesion, reprogramar: async () => (++n === 1 ? Promise.reject(CORTE()) : OKR), esperaReintentoMs: 0 })(post({}), contexto());
    expect(una.status).toBe(200);
    const dos = await crearRutaReprogramar({ sesion, reprogramar: async () => Promise.reject(CORTE()), esperaReintentoMs: 0 })(post({}), contexto());
    expect(dos.status).toBe(503);
  });
});

describe("GET /api/reservas/[id]/disponibilidad", () => {
  const get = (fecha = "2026-11-06") => new Request(`http://x/api/reservas/${ID}/disponibilidad?fecha=${fecha}`);

  function dependencias(extra: Partial<DependenciasDisponibilidadPropia> = {}) {
    const leerOcupacion = vi.fn(async (_v: { desde: Date; hasta: Date; excluirReservaId: string }) => ({
      equipos: [{ id: 1 }, { id: 2 }],
      ocupadas: [{ equipoId: 1, inicio: new Date("2026-11-06T18:00:00Z"), finBloqueo: new Date("2026-11-06T23:00:00Z") }],
    }));
    const deps: DependenciasDisponibilidadPropia = {
      leerReserva: async (usuarioId, reservaId) => (usuarioId === "u1" && reservaId === ID ? { horasAgenda: 4 } : null),
      leerConfig: async () => VALORES_DEL_DISENO,
      leerOcupacion,
      ...extra,
    };
    return { deps, leerOcupacion };
  }
  const ruta = (deps: DependenciasDisponibilidadPropia, extra: Parameters<typeof crearRutaDisponibilidadDeReserva>[0] = {}) =>
    crearRutaDisponibilidadDeReserva({
      sesion,
      ahora: () => AHORA,
      consultar: (e) => consultarDisponibilidadDeReserva(e, deps),
      esperaReintentoMs: 0,
      ...extra,
    });

  it("401 sin sesión", async () => {
    const { deps } = dependencias();
    expect((await ruta(deps, { sesion: sinSesion })(get(), contexto())).status).toBe(401);
  });

  it("404 si la reserva no es del cliente (y no consulta la ocupación)", async () => {
    const { deps, leerOcupacion } = dependencias({ leerReserva: async () => null });
    const r = await ruta(deps)(get(), contexto());
    expect(r.status).toBe(404);
    expect(leerOcupacion).not.toHaveBeenCalled();
  });

  it("404 para un id que no es uuid", async () => {
    const { deps } = dependencias();
    expect((await ruta(deps)(get(), contexto("abc"))).status).toBe(404);
  });

  it("422 con 2026-02-30", async () => {
    const { deps } = dependencias();
    const r = await ruta(deps)(get("2026-02-30"), contexto());
    expect(r.status).toBe(422);
  });

  it("la ocupación se lee con excluirReservaId igual al id del dueño y con las horas guardadas", async () => {
    const { deps, leerOcupacion } = dependencias();
    const r = await ruta(deps)(get(), contexto());
    expect(r.status).toBe(200);
    expect(leerOcupacion.mock.calls[0][0].excluirReservaId).toBe(ID);
    const cuerpo = await r.json();
    expect(cuerpo).toMatchObject({ fecha: "2026-11-06", atendido: true });
    // La respuesta es la de siempre: solo horarios, sin equipos ni datos de otros clientes.
    expect(JSON.stringify(cuerpo)).not.toMatch(/equipo|usuario|cliente/i);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("un corte seguido de éxito se reintenta; dos cortes dan 503", async () => {
    let n = 0;
    const { deps } = dependencias();
    const una = await ruta({ ...deps, leerConfig: async () => (++n === 1 ? Promise.reject(CORTE()) : VALORES_DEL_DISENO) })(get(), contexto());
    expect(una.status).toBe(200);
    const dos = await ruta({ ...deps, leerConfig: async () => Promise.reject(CORTE()) })(get(), contexto());
    expect(dos.status).toBe(503);
  });
});
