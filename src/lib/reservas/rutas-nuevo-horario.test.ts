import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../errores";
import type { Usuario } from "../sesion";
import type { RespuestaNuevoHorario } from "./nuevo-horario";
import type { DatosNuevoHorario } from "./nuevo-horario-datos";
import { crearRutaNuevoHorarioCrear, crearRutaNuevoHorarioDatos, crearRutaNuevoHorarioDisponibilidad } from "./rutas-nuevo-horario";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const USUARIO: Usuario = { id: "u1", correo: "a@tiza.test", nombre: "Ana", celular: "999111222", rol: "cliente" };
const ID = "11111111-1111-4111-8111-111111111111";
const AHORA = new Date("2026-11-02T15:00:00Z");
const sesion = async () => USUARIO;
const sinSesion = async () => {
  throw ErrorApi.sinSesion();
};
const contexto = (id = ID) => ({ params: Promise.resolve({ id }) });
const get = (consulta = "") => new Request(`http://x/api/pagos/${ID}/nuevo-horario${consulta}`);
const post = (cuerpo?: unknown, tipo: string | null = "application/json") =>
  new Request(`http://x/api/pagos/${ID}/nuevo-horario`, {
    method: "POST",
    headers: tipo ? { "content-type": tipo } : {},
    body: cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
const corte = () => Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("fetch failed"), { code: "ECONNRESET" }) });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const CREADA: RespuestaNuevoHorario = {
  reserva: {
    id: "r1",
    estado: "confirmada",
    servicio: { tipo: "profunda", dormitorios: 2, banos: 1 },
    inicio: "2026-11-07T10:00:00-05:00",
    fin: "2026-11-07T15:00:00-05:00",
    expira_en: null,
    monto: 6966,
    precio_lista: 19350,
    horas_gratis_aplicadas: 3,
    requiere_apoyo: false,
    apoyo_estado: null,
  },
  pago: { id: ID, concepto: "membresia_y_reserva", monto: 33666, metodo: "yape", estado: "aprobado" },
  credito_faltante_horas: 0,
  whatsapp: null,
};

describe("POST /api/pagos/[id]/nuevo-horario", () => {
  const ruta = (crear: unknown, s = sesion) => crearRutaNuevoHorarioCrear({ sesion: s, crear: crear as never, ahora: () => AHORA, esperaReintentoMs: 1 });

  it("401 sin sesión y no crea", async () => {
    const crear = vi.fn();
    expect((await ruta(crear, sinSesion)(post({}), contexto())).status).toBe(401);
    expect(crear).not.toHaveBeenCalled();
  });

  it("415 sin application/json y no crea", async () => {
    const crear = vi.fn();
    expect((await ruta(crear)(post("x=1", "text/plain"), contexto())).status).toBe(415);
    expect(crear).not.toHaveBeenCalled();
  });

  it("un JSON ilegible → 422", async () => {
    const crear = vi.fn();
    expect((await ruta(crear)(post("{no es json"), contexto())).status).toBe(422);
    expect(crear).not.toHaveBeenCalled();
  });

  it("201 con la forma, sin caché, con el usuario, el id de la URL y el cuerpo", async () => {
    const crear = vi.fn(async () => CREADA);
    const r = await ruta(crear)(post({ inicio: "2026-11-07T10:00:00-05:00" }), contexto());
    expect(r.status).toBe(201);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    const json = await r.json();
    expect(Object.keys(json).sort()).toEqual(["credito_faltante_horas", "pago", "reserva", "whatsapp"]);
    expect(json.reserva.estado).toBe("confirmada");
    expect(crear).toHaveBeenCalledWith({ usuario: USUARIO, pagoId: ID, cuerpo: { inicio: "2026-11-07T10:00:00-05:00" }, ahora: AHORA });
  });

  it("404 de un pago ajeno, 409 de cupo, 409 pago_en_credito y 422 con el formato único", async () => {
    const con = async (error: ErrorApi) =>
      ruta(
        vi.fn(async () => {
          throw error;
        }),
      )(post({}), contexto());
    expect((await con(ErrorApi.noEncontrado("No encontramos ese pago."))).status).toBe(404);
    const r409 = await con(ErrorApi.conflicto("Esa hora ya no está disponible. Elige otra hora."));
    expect(r409.status).toBe(409);
    expect((await r409.json()).error.codigo).toBe("conflicto");
    const rCredito = await con(new ErrorApi(409, "pago_en_credito", "Las horas de esa cancelación pasan a tu crédito. Úsalo en tu próxima reserva."));
    expect((await rCredito.json()).error.codigo).toBe("pago_en_credito");
    expect((await con(ErrorApi.invalido("Reserva con al menos 48 horas de anticipación."))).status).toBe(422);
  });

  it("un corte de conexión seguido de éxito responde 201", async () => {
    const crear = vi.fn().mockRejectedValueOnce(corte()).mockResolvedValueOnce(CREADA);
    const r = await ruta(crear)(post({}), contexto());
    expect(r.status).toBe(201);
    expect(crear).toHaveBeenCalledTimes(2);
  });

  it("dos cortes dan 503 «Inténtalo en unos segundos.»", async () => {
    const r = await ruta(
      vi.fn(async () => {
        throw corte();
      }),
    )(post({}), contexto());
    expect(r.status).toBe(503);
    expect((await r.json()).error.mensaje).toBe("Inténtalo en unos segundos.");
  });
});

describe("GET /api/pagos/[id]/nuevo-horario", () => {
  const DATOS = { pago: { id: ID, monto_pagado: 33666 }, limite: "2027-01-20T10:00:00-05:00" } as unknown as DatosNuevoHorario;
  const ruta = (leer: unknown, s = sesion) => crearRutaNuevoHorarioDatos({ sesion: s, leer: leer as never, ahora: () => AHORA, esperaReintentoMs: 1 });

  it("401 sin sesión", async () => {
    const leer = vi.fn();
    expect((await ruta(leer, sinSesion)(get(), contexto())).status).toBe(401);
    expect(leer).not.toHaveBeenCalled();
  });

  it("200 sin caché, con el usuario de la sesión y el id de la URL", async () => {
    const leer = vi.fn(async () => DATOS);
    const r = await ruta(leer)(get(), contexto());
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(leer).toHaveBeenCalledWith({ usuario: USUARIO, pagoId: ID, ahora: AHORA });
  });

  it("404 de un pago ajeno o un id inválido", async () => {
    const r = await ruta(
      vi.fn(async () => {
        throw ErrorApi.noEncontrado("No encontramos ese pago.");
      }),
    )(get(), contexto("abc"));
    expect(r.status).toBe(404);
  });

  it("un corte de conexión seguido de éxito y dos cortes seguidos", async () => {
    const leer = vi.fn().mockRejectedValueOnce(corte()).mockResolvedValueOnce(DATOS);
    expect((await ruta(leer)(get(), contexto())).status).toBe(200);
    expect(
      (
        await ruta(
          vi.fn(async () => {
            throw corte();
          }),
        )(get(), contexto())
      ).status,
    ).toBe(503);
  });
});

describe("GET /api/pagos/[id]/nuevo-horario/disponibilidad", () => {
  const ruta = (consultar: unknown, s = sesion) => crearRutaNuevoHorarioDisponibilidad({ sesion: s, consultar: consultar as never, ahora: () => AHORA, esperaReintentoMs: 1 });
  const fallar = (error: unknown) =>
    vi.fn(async () => {
      throw error;
    });

  it("401 sin sesión", async () => {
    expect((await ruta(vi.fn(), sinSesion)(get("/disponibilidad?fecha=2026-11-07"), contexto())).status).toBe(401);
  });

  it("200 y pasa la fecha de la consulta, el usuario y el id", async () => {
    const consultar = vi.fn(async () => ({ fecha: "2026-11-07", atendido: true, horarios: [] }));
    const r = await ruta(consultar)(get("/disponibilidad?fecha=2026-11-07"), contexto());
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(consultar).toHaveBeenCalledWith({ usuario: USUARIO, pagoId: ID, fecha: "2026-11-07", ahora: AHORA });
  });

  it("422 de una fecha inválida y 404 de un pago ajeno", async () => {
    expect((await ruta(fallar(ErrorApi.invalido("Escribe una fecha válida con el formato AAAA-MM-DD.")))(get("/disponibilidad?fecha=2026-02-30"), contexto())).status).toBe(422);
    expect((await ruta(fallar(ErrorApi.noEncontrado("No encontramos ese pago.")))(get("/disponibilidad?fecha=2026-11-07"), contexto())).status).toBe(404);
  });

  it("dos cortes dan 503", async () => {
    expect((await ruta(fallar(corte()))(get("/disponibilidad?fecha=2026-11-07"), contexto())).status).toBe(503);
  });
});
