import { afterEach, describe, expect, it, vi } from "vitest";
import { authEnMemoria, registrarConSesion } from "./__fixtures__/auth";

const datosRegistro = { email: "ana@correo.com", password: "clave-segura-1", name: "Ana", telefono: "987654321" };

describe("crearAuth", () => {
  it("guarda la contraseña solo como hash", async () => {
    const { auth, datos } = authEnMemoria();
    await auth.api.signUpEmail({ body: datosRegistro });
    const guardado = JSON.stringify(datos);
    expect(guardado).not.toContain(datosRegistro.password);
    expect(datos.cuentas[0].password).toEqual(expect.any(String));
    expect(datos.cuentas[0].password).not.toBe(datosRegistro.password);
  });

  it("ignora un rol enviado al registrarse y deja la cuenta como cliente", async () => {
    const { auth, datos } = authEnMemoria();
    await auth.api.signUpEmail({ body: { ...datosRegistro, rol: "admin" } as typeof datosRegistro });
    expect(datos.usuarios[0].rol).toBe("cliente");
  });

  it("guarda el teléfono", async () => {
    const { auth, datos } = authEnMemoria();
    await auth.api.signUpEmail({ body: datosRegistro });
    expect(datos.usuarios[0].telefono).toBe("987654321");
  });

  it("rechaza contraseñas de menos de 8 caracteres", async () => {
    const { auth } = authEnMemoria();
    await expect(auth.api.signUpEmail({ body: { ...datosRegistro, password: "1234567" } })).rejects.toThrow();
  });
});

describe("restablecimiento de contraseña", () => {
  afterEach(() => vi.useRealTimers());

  const tokenDe = (enlace: string) => new URL(enlace).searchParams.get("token")!;

  async function pedir(m = authEnMemoria()) {
    await m.auth.api.signUpEmail({ body: datosRegistro });
    await m.auth.api.requestPasswordReset({ body: { email: datosRegistro.email } });
    return { ...m, token: tokenDe(m.correos[0].enlace) };
  }

  it("envía un solo correo con el enlace a /restablecer si la cuenta existe", async () => {
    const { correos } = await pedir();
    expect(correos).toHaveLength(1);
    expect(correos[0]).toMatchObject({ para: datosRegistro.email, nombre: "Ana" });
    expect(correos[0].enlace).toMatch(/^http:\/\/localhost:3000\/restablecer\?token=.+/);
  });

  it("responde igual y no envía correo si la cuenta no existe", async () => {
    const m = authEnMemoria();
    const existente = await pedir();
    const respuestaExistente = await existente.auth.api.requestPasswordReset({ body: { email: datosRegistro.email } });
    const respuestaInexistente = await m.auth.api.requestPasswordReset({ body: { email: "nadie@correo.com" } });
    expect(respuestaInexistente).toEqual(respuestaExistente);
    expect(m.correos).toHaveLength(0);
  });

  it("guarda el token solo como hash", async () => {
    const { datos, token } = await pedir();
    expect(JSON.stringify(datos.verificaciones)).not.toContain(token);
    expect(datos.verificaciones).toHaveLength(1);
    expect(datos.verificaciones[0].identifier).not.toMatch(/^reset-password:/);
  });

  it("cambia la contraseña y el enlace sirve una sola vez", async () => {
    const { auth, token } = await pedir();
    await auth.api.resetPassword({ body: { token, newPassword: "otra-clave-nueva" } });
    await expect(auth.api.signInEmail({ body: { email: datosRegistro.email, password: "otra-clave-nueva" } })).resolves.toBeDefined();
    await expect(auth.api.signInEmail({ body: { email: datosRegistro.email, password: datosRegistro.password } })).rejects.toThrow();
    await expect(auth.api.resetPassword({ body: { token, newPassword: "una-tercera-clave" } })).rejects.toMatchObject({
      body: { code: "INVALID_TOKEN" },
    });
  });

  it("deja de servir pasada 1 hora", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { auth, token } = await pedir();
    vi.setSystemTime(Date.now() + 60 * 60 * 1000 + 1000);
    await expect(auth.api.resetPassword({ body: { token, newPassword: "otra-clave-nueva" } })).rejects.toMatchObject({
      body: { code: "INVALID_TOKEN" },
    });
  });

  it("sirve antes de cumplirse la hora", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { auth, token } = await pedir();
    vi.setSystemTime(Date.now() + 59 * 60 * 1000);
    await expect(auth.api.resetPassword({ body: { token, newPassword: "otra-clave-nueva" } })).resolves.toBeDefined();
  });

  it("rechaza un token inventado", async () => {
    const { auth } = await pedir();
    await expect(auth.api.resetPassword({ body: { token: "inventado", newPassword: "otra-clave-nueva" } })).rejects.toMatchObject({
      body: { code: "INVALID_TOKEN" },
    });
  });

  it("con una contraseña corta falla y conserva el token", async () => {
    const { auth, token } = await pedir();
    await expect(auth.api.resetPassword({ body: { token, newPassword: "1234567" } })).rejects.toMatchObject({
      body: { code: "PASSWORD_TOO_SHORT" },
    });
    await expect(auth.api.resetPassword({ body: { token, newPassword: "otra-clave-nueva" } })).resolves.toBeDefined();
  });

  it("cierra las sesiones abiertas", async () => {
    const m = authEnMemoria();
    const cabeceras = await registrarConSesion(m.auth);
    expect(await m.auth.api.getSession({ headers: cabeceras })).not.toBeNull();
    await m.auth.api.requestPasswordReset({ body: { email: datosRegistro.email } });
    await m.auth.api.resetPassword({ body: { token: tokenDe(m.correos[0].enlace), newPassword: "otra-clave-nueva" } });
    expect(await m.auth.api.getSession({ headers: cabeceras })).toBeNull();
  });

  // El uso simultáneo no se prueba aquí: el adaptador de memoria copia la base por transacción y no es atómico.
  // Se verifica contra Neon (DELETE ... RETURNING) en la prueba con curl del change.
});
