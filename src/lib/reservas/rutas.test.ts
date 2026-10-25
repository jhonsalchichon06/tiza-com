import { beforeEach, describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { instanteLocal } from "../agenda/horario";
import { ErrorApi } from "../errores";
import type { Usuario } from "../sesion";
import type { ClaveHogar } from "../direccion";
import type { crearPrimeraReserva, RespuestaReserva } from "./crear";
import type { MotivoSinGratis } from "./gratis";
import type { MembresiaQueAutoriza } from "./membresia-vigente";
import { crearRutaCotizacion, crearRutaReservas } from "./rutas";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const USUARIO: Usuario = { id: "u1", correo: "u1@tiza.test", nombre: "Ana", celular: "987654321", rol: "cliente" };
const AHORA = instanteLocal("2026-11-02", "10:00", "America/Lima");
const sesionOk = async () => USUARIO;
const sinSesion = async () => {
  throw ErrorApi.sinSesion();
};

const RESPUESTA: RespuestaReserva = {
  reserva: {
    id: "r1",
    estado: "pendiente",
    servicio: { tipo: "profunda", dormitorios: 2, banos: 1 },
    inicio: "2026-11-07T10:00:00-05:00",
    fin: "2026-11-07T15:00:00-05:00",
    expira_en: "2026-11-03T10:00:00-05:00",
    monto: 6966,
    precio_lista: 19350,
    horas_gratis_aplicadas: 3,
    requiere_apoyo: false,
  },
  membresia: { id: "m1", estado: "pendiente", monto: 26700 },
  pago: { id: "p1", concepto: "membresia_y_reserva", monto: 33666, metodo: "yape", estado: "pendiente" },
  whatsapp: "https://wa.me/51912345678?text=Hola",
};

const peticion = (cuerpo: unknown = { x: 1 }, tipo = "application/json") =>
  new Request("http://localhost/api/reservas", {
    method: "POST",
    headers: { "content-type": tipo },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });

const ruta = (crear: typeof crearPrimeraReserva, sesion = sesionOk) => crearRutaReservas({ sesion, crear, ahora: () => AHORA, esperaReintentoMs: 1 });
// Los reintentos y errores esperados escriben en el registro; aquí no interesa verlos.
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const corte = () => Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" });

describe("POST /api/reservas", () => {
  it("sin sesión → 401 con el formato único y no llama a crear", async () => {
    const crear = vi.fn();
    const r = await ruta(crear as never, sinSesion)(peticion());
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: { codigo: "sin_sesion", mensaje: "Inicia sesión para continuar." } });
    expect(crear).not.toHaveBeenCalled();
  });

  it("con text/plain → 415 y no llama a crear", async () => {
    const crear = vi.fn();
    const r = await ruta(crear as never)(peticion("{}", "text/plain"));
    expect(r.status).toBe(415);
    expect((await r.json()).error.codigo).toBe("tipo_no_soportado");
    expect(crear).not.toHaveBeenCalled();
  });

  it("un JSON ilegible → 422", async () => {
    const crear = vi.fn();
    const r = await ruta(crear as never)(peticion("{no es json"));
    expect(r.status).toBe(422);
    expect(crear).not.toHaveBeenCalled();
  });

  it("201 con la forma de la respuesta y llama a crear con el usuario, el cuerpo y la hora", async () => {
    const crear = vi.fn(async () => RESPUESTA);
    const r = await ruta(crear as never)(peticion({ hola: "mundo" }));
    expect(r.status).toBe(201);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    const json = await r.json();
    expect(Object.keys(json).sort()).toEqual(["membresia", "pago", "reserva", "whatsapp"]);
    expect(json.pago).toMatchObject({ concepto: "membresia_y_reserva", monto: 33666, estado: "pendiente" });
    expect(crear).toHaveBeenCalledWith({ usuario: USUARIO, cuerpo: { hola: "mundo" }, ahora: AHORA });
  });

  it("un 409 y un 422 salen con el formato único de errores", async () => {
    const r409 = await ruta((async () => { throw new ErrorApi(409, "en_espera", "Ya tienes una reserva esperando la aprobación de tu pago."); }) as never)(peticion());
    expect(r409.status).toBe(409);
    expect(await r409.json()).toEqual({ error: { codigo: "en_espera", mensaje: "Ya tienes una reserva esperando la aprobación de tu pago." } });
    const r422 = await ruta((async () => { throw ErrorApi.invalido("Sube el comprobante de tu pago para continuar."); }) as never)(peticion());
    expect(r422.status).toBe(422);
    expect((await r422.json()).error.codigo).toBe("datos_invalidos");
  });

  it("un corte de conexión seguido de éxito crea una sola vez (Drizzle lo envuelve en cause)", async () => {
    const crear = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Failed query"), { cause: corte() }))
      .mockResolvedValueOnce(RESPUESTA);
    const r = await ruta(crear as never)(peticion());
    expect(r.status).toBe(201);
    expect(crear).toHaveBeenCalledTimes(2);
  });

  it("dos cortes → 503 «Inténtalo en unos segundos.»", async () => {
    const crear = vi.fn(async () => {
      throw Object.assign(new Error("Failed query"), { cause: corte() });
    });
    const r = await ruta(crear as never)(peticion());
    expect(r.status).toBe(503);
    expect((await r.json()).error.mensaje).toBe("Inténtalo en unos segundos.");
    expect(crear).toHaveBeenCalledTimes(2);
  });

  it("un error inesperado → 500 genérico sin detalles", async () => {
    const crear = vi.fn(async () => {
      throw new Error("password authentication failed for user neondb_owner");
    });
    const r = await ruta(crear as never)(peticion());
    expect(r.status).toBe(500);
    const texto = JSON.stringify(await r.json());
    expect(texto).toContain("Algo salió mal");
    expect(texto).not.toMatch(/password|neondb/);
  });
});

describe("GET /api/cotizacion", () => {
  const url = (consulta: string) => new Request(`http://localhost/api/cotizacion?${consulta}`);
  const get = (
    sesion = sesionOk,
    leerConfig = vi.fn(async () => VALORES_DEL_DISENO),
    decidir = vi.fn(async (_usuarioId: string, _hogar: ClaveHogar | null): Promise<MotivoSinGratis | null> => null),
    // Sin membresía activa por defecto: la cotización de la primera membresía de siempre.
    leerMembresia: (usuarioId: string) => Promise<MembresiaQueAutoriza | null> = async () => null,
    credito: (usuarioId: string, horasMaximas: number) => Promise<number> = async () => 0,
  ) => ({
    GET: crearRutaCotizacion({ sesion, leerConfig, decidir, leerMembresia, credito, ahora: () => AHORA, esperaReintentoMs: 1 }),
    leerConfig,
    decidir,
  });

  it("sin sesión → 401", async () => {
    const { GET, leerConfig } = get(sinSesion);
    expect((await GET(url("tipo=estandar&dormitorios=1&banos=1"))).status).toBe(401);
    expect(leerConfig).not.toHaveBeenCalled();
  });

  it.each([
    ["un paquete de 5 horas", "tipo=paquete&horas=5", /paquete/],
    ["una estándar con 0 baños", "tipo=estandar&dormitorios=1&banos=0", /baño/],
    ["un tipo inválido", "tipo=lujo", /tipo de servicio/],
    ["un servicio sin baños", "tipo=profunda&dormitorios=2", /baños/],
  ])("%s → 422", async (_n, consulta, mensaje) => {
    const r = await get().GET(url(consulta));
    expect(r.status).toBe(422);
    expect((await r.json()).error.mensaje).toMatch(mensaje);
  });

  it("profunda 2/1 → 200 con la cotización (total 33666)", async () => {
    const r = await get().GET(url("tipo=profunda&dormitorios=2&banos=1"));
    expect(r.status).toBe(200);
    const c = await r.json();
    expect(c).toMatchObject({
      horas_trabajo: 5,
      precio_lista: 19350,
      horas_gratis_aplicadas: 3,
      monto: 6966,
      membresia: { mensual: 8900, meses: 3, total: 26700 },
      total_a_pagar: 33666,
      espera_pago_horas: 24,
      fechas: { desde: "2026-11-04", hasta: "2027-02-02" },
      limite: "2027-02-02T10:00:00-05:00",
    });
  });

  it("estándar 1/1 → total 26700", async () => {
    const c = await (await get().GET(url("tipo=estandar&dormitorios=1&banos=1"))).json();
    expect(c.monto).toBe(0);
    expect(c.total_a_pagar).toBe(26700);
  });

  it("lleva Cache-Control: private, no-store", async () => {
    const r = await get().GET(url("tipo=paquete&horas=3"));
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });

  it("es de solo lectura: solo lee la configuración y la base real nunca se toca", async () => {
    const { GET, leerConfig } = get();
    await GET(url("tipo=paquete&horas=3"));
    expect(leerConfig).toHaveBeenCalledTimes(1);
  });

  it("un corte de conexión al leer la configuración se reintenta una vez", async () => {
    const leerConfig = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Failed query"), { cause: corte() }))
      .mockResolvedValueOnce(VALORES_DEL_DISENO);
    const r = await get(sesionOk, leerConfig as never).GET(url("tipo=paquete&horas=3"));
    expect(r.status).toBe(200);
    expect(leerConfig).toHaveBeenCalledTimes(2);
  });

  describe("con la dirección del hogar", () => {
    const PROFUNDA = "tipo=profunda&dormitorios=2&banos=1";
    const LARCO = "distrito=Miraflores&calle=Av.%20Larco&numero=123&departamento=Dpto.%20302";
    const HOGAR: ClaveHogar = { distrito: "Miraflores", direccionNormalizada: "avenida larco 123", departamentoNormalizado: "dpto 302" };

    it("hogar que ya recibió la gratis → aplica_gratis falso, motivo hogar y total 44115", async () => {
      const decidir = vi.fn(async () => "hogar" as const);
      const { GET } = get(sesionOk, undefined, decidir);
      const c = await (await GET(url(`${PROFUNDA}&${LARCO}`))).json();
      expect(c).toMatchObject({ aplica_gratis: false, motivo_sin_gratis: "hogar", horas_gratis_aplicadas: 0, monto: 17415, total_a_pagar: 44115 });
      expect(decidir).toHaveBeenCalledWith("u1", HOGAR);
    });

    it("cliente con una reserva → motivo cliente", async () => {
      const { GET } = get(sesionOk, undefined, vi.fn(async () => "cliente" as const));
      const c = await (await GET(url(`${PROFUNDA}&${LARCO}`))).json();
      expect(c).toMatchObject({ aplica_gratis: false, motivo_sin_gratis: "cliente", total_a_pagar: 44115 });
    });

    it("hogar nuevo → aplica_gratis, motivo null y total 33666", async () => {
      const c = await (await get().GET(url(`${PROFUNDA}&${LARCO}`))).json();
      expect(c).toMatchObject({ aplica_gratis: true, motivo_sin_gratis: null, total_a_pagar: 33666 });
    });

    it("sin dirección conserva la forma anterior y decide solo por el cliente (hogar nulo)", async () => {
      const { GET, decidir } = get();
      const c = await (await GET(url(PROFUNDA))).json();
      expect(c).toMatchObject({ aplica_gratis: true, motivo_sin_gratis: null, total_a_pagar: 33666 });
      expect(decidir).toHaveBeenCalledWith("u1", null);
    });

    it.each([
      ["un distrito fuera de los 9", "distrito=La%20Molina&calle=Larco&numero=123", /distritos que atendemos/],
      ["un número sin dígitos", "distrito=Miraflores&calle=Larco&numero=s%2Fn", /dígito/],
      ["solo el distrito", "distrito=Miraflores", /calle/i],
    ])("%s → 422 y no se lee ninguna reserva", async (_n, direccion, mensaje) => {
      const { GET, decidir } = get();
      const r = await GET(url(`${PROFUNDA}&${direccion}`));
      expect(r.status).toBe(422);
      expect((await r.json()).error.mensaje).toMatch(mensaje);
      expect(decidir).not.toHaveBeenCalled();
    });

    it("sin sesión → 401 y no decide", async () => {
      const { GET, decidir } = get(sinSesion);
      expect((await GET(url(`${PROFUNDA}&${LARCO}`))).status).toBe(401);
      expect(decidir).not.toHaveBeenCalled();
    });

    it("lleva Cache-Control: private, no-store", async () => {
      const r = await get().GET(url(`${PROFUNDA}&${LARCO}`));
      expect(r.headers.get("cache-control")).toBe("private, no-store");
    });

    it("un corte de conexión al decidir se reintenta una vez y responde 200", async () => {
      const decidir = vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error("Failed query"), { cause: corte() }))
        .mockResolvedValueOnce(null);
      const r = await get(sesionOk, undefined, decidir as never).GET(url(`${PROFUNDA}&${LARCO}`));
      expect(r.status).toBe(200);
      expect(decidir).toHaveBeenCalledTimes(2);
    });
  });

  describe("como miembro activo", () => {
    const FIN = instanteLocal("2027-01-20", "10:00", "America/Lima");
    const activa = async (): Promise<MembresiaQueAutoriza> => ({ id: "m1", inicio: AHORA, fin: FIN, vigente: true });
    const ESTANDAR = "tipo=estandar&dormitorios=2&banos=1";

    it("modo miembro: sin membresía en el total, descuento y límite igual al fin", async () => {
      const r = await get(sesionOk, undefined, vi.fn(async () => "cliente" as const), activa).GET(url(ESTANDAR));
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({
        modo: "miembro",
        membresia: null,
        precio_lista: 12900,
        descuento: 1290,
        monto: 11610,
        total_a_pagar: 11610,
        limite: "2027-01-20T10:00:00-05:00",
        membresia_fin: "2027-01-20T10:00:00-05:00",
        membresia_vigente: true,
        fechas: { desde: "2026-11-04", hasta: "2027-01-20" },
      });
    });

    it("quien no es miembro recibe el modo primera", async () => {
      const c = await (await get().GET(url(ESTANDAR))).json();
      expect(c).toMatchObject({ modo: "primera", membresia: { total: 26700 } });
    });

    it("miembro con la primera cancelada: aplica_gratis y total 0 para 3 h", async () => {
      const c = await (await get(sesionOk, undefined, undefined, activa).GET(url("tipo=paquete&horas=3"))).json();
      expect(c).toMatchObject({ modo: "miembro", aplica_gratis: true, monto: 0, total_a_pagar: 0 });
    });

    it("pasa el crédito de creditoParaReserva al cálculo", async () => {
      const credito = vi.fn(async () => 2);
      const c = await (await get(sesionOk, undefined, vi.fn(async () => "cliente" as const), activa, credito).GET(url(ESTANDAR))).json();
      expect(credito).toHaveBeenCalledWith("u1", 4);
      expect(c).toMatchObject({ credito_aplicado: 2, monto: 5805 });
    });

    it("devuelve credito_disponible, credito_aplicado y cubierta_por_credito", async () => {
      const parcial = await (await get(sesionOk, undefined, vi.fn(async () => "cliente" as const), activa, async () => 2).GET(url(ESTANDAR))).json();
      expect(parcial).toMatchObject({ credito_disponible: 2, credito_aplicado: 2, cubierta_por_credito: false });
      const cubierta = await (await get(sesionOk, undefined, vi.fn(async () => "cliente" as const), activa, async () => 6).GET(url(ESTANDAR))).json();
      expect(cubierta).toMatchObject({ credito_disponible: 6, credito_aplicado: 4, monto: 0, cubierta_por_credito: true });
      const sin = await (await get(sesionOk, undefined, vi.fn(async () => "cliente" as const), activa).GET(url(ESTANDAR))).json();
      expect(sin).toMatchObject({ credito_disponible: 0, credito_aplicado: 0, cubierta_por_credito: false });
    });

    it("membresía vencida: membresia_vigente falso", async () => {
      const vencida = async (): Promise<MembresiaQueAutoriza> => ({ id: "m1", inicio: AHORA, fin: new Date(AHORA.getTime() - 86_400_000), vigente: false });
      const c = await (await get(sesionOk, undefined, undefined, vencida).GET(url(ESTANDAR))).json();
      expect(c.membresia_vigente).toBe(false);
      expect(c.fechas.hasta < c.fechas.desde).toBe(true);
    });

    it("sin sesión → 401 y no lee la membresía", async () => {
      const leer = vi.fn(activa);
      expect((await get(sinSesion, undefined, undefined, leer).GET(url(ESTANDAR))).status).toBe(401);
      expect(leer).not.toHaveBeenCalled();
    });

    it("un corte de conexión al leer la membresía se reintenta una vez", async () => {
      const leer = vi.fn().mockRejectedValueOnce(Object.assign(new Error("Failed query"), { cause: corte() })).mockImplementationOnce(activa);
      const r = await get(sesionOk, undefined, undefined, leer as never).GET(url(ESTANDAR));
      expect(r.status).toBe(200);
      expect((await r.json()).modo).toBe("miembro");
      expect(leer).toHaveBeenCalledTimes(2);
    });
  });
});
