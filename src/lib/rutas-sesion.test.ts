import { beforeEach, describe, expect, it, vi } from "vitest";
import { authEnMemoria, cookieDe } from "./__fixtures__/auth";
import { crearRutasSesion } from "./rutas-sesion";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const URL_BASE = "http://localhost:3000/api/sesion";
const json = (cuerpo: unknown, cookie?: string) =>
  ({ method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(cuerpo) });
const REGISTRO = { correo: "Ana@Correo.com", contrasena: "clave-segura-1", nombre: "Ana", celular: "987654321" };

let memoria: ReturnType<typeof authEnMemoria>;
let rutas: ReturnType<typeof crearRutasSesion>;

beforeEach(() => {
  memoria = authEnMemoria();
  rutas = crearRutasSesion(() => memoria.auth);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const registrar = (cuerpo: unknown = REGISTRO) => rutas.registro(new Request(`${URL_BASE}/registro`, json(cuerpo)));
const iniciar = (cuerpo: unknown) => rutas.iniciar(new Request(URL_BASE, json(cuerpo)));
const actual = (cookie?: string) => rutas.actual(new Request(URL_BASE, { headers: cookie ? { cookie } : {} }));
const cerrar = (cookie?: string) =>
  rutas.cerrar(new Request(URL_BASE, { method: "DELETE", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) } }));

describe("POST /api/sesion/registro", () => {
  it("responde 201 con el usuario sin contraseña ni hash y con la cookie de sesión", async () => {
    const res = await registrar();
    const cuerpo = await res.text();
    expect(res.status).toBe(201);
    expect(JSON.parse(cuerpo)).toEqual({
      usuario: { id: expect.any(String), correo: "ana@correo.com", nombre: "Ana", celular: "987654321", rol: "cliente" },
    });
    expect(cuerpo).not.toContain("clave-segura-1");
    expect(cuerpo).not.toMatch(/password|hash/i);
    expect(res.headers.getSetCookie().join()).toMatch(/session_token=.*HttpOnly/i);
  });

  it.each([
    [{ contrasena: "1234567" }, /al menos 8 caracteres/],
    [{ celular: "12345678" }, /celular/],
  ])("responde 422 con %j y no crea la cuenta", async (cambio, mensaje) => {
    const res = await registrar({ ...REGISTRO, ...cambio });
    expect(res.status).toBe(422);
    expect((await res.json()).error.mensaje).toMatch(mensaje);
    expect(memoria.datos.usuarios).toHaveLength(0);
  });

  it("responde 409 con un correo repetido aunque cambien las mayúsculas, sin crear otra cuenta", async () => {
    await registrar();
    const res = await registrar({ ...REGISTRO, correo: "ANA@correo.COM" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.mensaje).toBe("Ese correo ya tiene una cuenta. Inicia sesión.");
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect(memoria.datos.usuarios).toHaveLength(1);
  });

  it("ignora un rol enviado y crea la cuenta como cliente", async () => {
    const res = await registrar({ ...REGISTRO, rol: "admin" });
    expect((await res.json()).usuario.rol).toBe("cliente");
  });

  it("responde 415 si no se envía JSON", async () => {
    const res = await rutas.registro(new Request(`${URL_BASE}/registro`, { method: "POST", body: "correo=a" }));
    expect(res.status).toBe(415);
  });
});

describe("/api/sesion", () => {
  it("el inicio correcto responde 200 con una cookie HttpOnly", async () => {
    await registrar();
    const res = await iniciar({ correo: " ana@correo.com ", contrasena: "clave-segura-1" });
    expect(res.status).toBe(200);
    expect((await res.json()).usuario.correo).toBe("ana@correo.com");
    expect(res.headers.getSetCookie().join()).toMatch(/session_token=.*HttpOnly.*SameSite=Lax/i);
  });

  it("contraseña incorrecta y correo inexistente dan el mismo 401 genérico", async () => {
    await registrar();
    const malaClave = await iniciar({ correo: "ana@correo.com", contrasena: "otra-clave-9" });
    const sinCuenta = await iniciar({ correo: "nadie@correo.com", contrasena: "otra-clave-9" });
    expect(malaClave.status).toBe(401);
    expect(sinCuenta.status).toBe(401);
    expect(await malaClave.json()).toEqual(await sinCuenta.json());
    expect(malaClave.headers.getSetCookie()).toHaveLength(0);
  });

  it("GET devuelve el usuario con sesión y 401 sin ella", async () => {
    const cookie = cookieDe(await registrar());
    const con = await actual(cookie);
    expect(con.status).toBe(200);
    expect((await con.json()).usuario).toMatchObject({ correo: "ana@correo.com", rol: "cliente" });
    expect((await actual()).status).toBe(401);
  });

  it("después de DELETE la cookie anterior recibe 401", async () => {
    const cookie = cookieDe(await registrar());
    const res = await cerrar(cookie);
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie().join()).toMatch(/session_token=;/);
    expect((await actual(cookie)).status).toBe(401);
  });

  it("DELETE sin sesión responde 204", async () => {
    expect((await cerrar()).status).toBe(204);
  });
});

describe("POST /api/sesion/olvide y /api/sesion/restablecer", () => {
  const olvide = (cuerpo: unknown) => rutas.olvide(new Request(`${URL_BASE}/olvide`, json(cuerpo)));
  const restablecer = (cuerpo: unknown) => rutas.restablecer(new Request(`${URL_BASE}/restablecer`, json(cuerpo)));
  const tokenDelCorreo = () => new URL(memoria.correos[0].enlace).searchParams.get("token")!;

  it("responde 200 con el mismo cuerpo exista o no la cuenta, y envía correo solo si existe", async () => {
    await registrar();
    const con = await olvide({ correo: " ANA@correo.com " });
    const sin = await olvide({ correo: "nadie@correo.com" });
    expect(con.status).toBe(200);
    expect(sin.status).toBe(200);
    expect(await sin.json()).toEqual(await con.json());
    expect(memoria.correos).toHaveLength(1);
    expect(memoria.correos[0].para).toBe("ana@correo.com");
  });

  it("responde 422 con un correo inválido y 415 sin JSON", async () => {
    expect((await olvide({ correo: "no-es-correo" })).status).toBe(422);
    const res = await rutas.olvide(new Request(`${URL_BASE}/olvide`, { method: "POST", body: "correo=a" }));
    expect(res.status).toBe(415);
  });

  it("restablece la contraseña sin iniciar sesión y rechaza el segundo uso del enlace", async () => {
    await registrar();
    await olvide({ correo: "ana@correo.com" });
    const token = tokenDelCorreo();
    const res = await restablecer({ token, contrasena: "otra-clave-nueva" });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect((await iniciar({ correo: "ana@correo.com", contrasena: "otra-clave-nueva" })).status).toBe(200);
    expect((await iniciar({ correo: "ana@correo.com", contrasena: "clave-segura-1" })).status).toBe(401);

    const segundo = await restablecer({ token, contrasena: "una-tercera-clave" });
    expect(segundo.status).toBe(400);
    expect((await segundo.json()).error.codigo).toBe("enlace_invalido");
  });

  it("responde 400 enlace_invalido con un token inventado", async () => {
    const res = await restablecer({ token: "inventado", contrasena: "otra-clave-nueva" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({
      codigo: "enlace_invalido",
      mensaje: "El enlace no es válido o ya venció. Pide uno nuevo.",
    });
  });

  it("responde 422 con una contraseña corta y el enlace sigue sirviendo", async () => {
    await registrar();
    await olvide({ correo: "ana@correo.com" });
    const token = tokenDelCorreo();
    const corta = await restablecer({ token, contrasena: "1234567" });
    expect(corta.status).toBe(422);
    expect((await corta.json()).error.mensaje).toMatch(/al menos 8 caracteres/);
    expect((await restablecer({ token, contrasena: "otra-clave-nueva" })).status).toBe(200);
  });
});
