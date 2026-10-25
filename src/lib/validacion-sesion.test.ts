import { describe, expect, it } from "vitest";
import { ErrorApi } from "./errores";
import { esquemaInicio, esquemaOlvide, esquemaRegistro, esquemaRestablecer, traducirErrorAuth, validar } from "./validacion-sesion";

const valido = { correo: "  Ana@Correo.COM ", contrasena: "clave-segura-1", nombre: " Ana ", celular: "987 654 321" };

const errorDe = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("no lanzó");
};

describe("validar registro", () => {
  it("normaliza correo, nombre y celular", () => {
    expect(validar(esquemaRegistro, valido)).toEqual({
      correo: "ana@correo.com",
      contrasena: "clave-segura-1",
      nombre: "Ana",
      celular: "987654321",
    });
  });

  it.each([
    [{ contrasena: "1234567" }, /al menos 8 caracteres/],
    [{ correo: "ana@" }, /correo válido/],
    [{ nombre: "   " }, /nombre/],
    [{ celular: "12345678" }, /celular de 9 dígitos/],
    [{ celular: "887654321" }, /celular de 9 dígitos/],
  ])("rechaza %j con 422 y un mensaje en español", (cambio, mensaje) => {
    const error = errorDe(() => validar(esquemaRegistro, { ...valido, ...cambio }));
    expect(error.status).toBe(422);
    expect(error.message).toMatch(mensaje);
  });

  it("ignora un rol enviado en el cuerpo", () => {
    expect(validar(esquemaRegistro, { ...valido, rol: "admin" })).not.toHaveProperty("rol");
  });
});

describe("validar inicio de sesión", () => {
  it("exige correo y contraseña", () => {
    expect(errorDe(() => validar(esquemaInicio, { correo: "ana@correo.com" })).status).toBe(422);
  });
});

describe("traducirErrorAuth", () => {
  const deBetterAuth = (code: string) => ({ body: { code, message: "en inglés" } });

  it("convierte el correo repetido en 409", () => {
    expect(traducirErrorAuth(deBetterAuth("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"))).toMatchObject({
      status: 409,
      message: "Ese correo ya tiene una cuenta. Inicia sesión.",
    });
  });

  it("convierte las credenciales inválidas en un 401 genérico", () => {
    expect(traducirErrorAuth(deBetterAuth("INVALID_EMAIL_OR_PASSWORD"))).toMatchObject({
      status: 401,
      message: "Correo o contraseña incorrectos.",
    });
  });

  it("convierte un token inválido, vencido o usado en 400 enlace_invalido", () => {
    for (const codigo of ["INVALID_TOKEN", "USER_NOT_FOUND"]) {
      expect(traducirErrorAuth(deBetterAuth(codigo))).toMatchObject({
        status: 400,
        codigo: "enlace_invalido",
        message: "El enlace no es válido o ya venció. Pide uno nuevo.",
      });
    }
  });

  it("deja pasar los errores desconocidos", () => {
    const otro = new Error("x");
    expect(traducirErrorAuth(otro)).toBe(otro);
    expect(traducirErrorAuth(deBetterAuth("ALGO_NUEVO"))).toEqual(deBetterAuth("ALGO_NUEVO"));
  });
});

describe("esquemaOlvide y esquemaRestablecer", () => {
  it("normaliza el correo", () => {
    expect(validar(esquemaOlvide, { correo: "  Ana@Correo.COM " })).toEqual({ correo: "ana@correo.com" });
  });

  it("rechaza un correo inválido con 422", () => {
    const error = errorDe(() => validar(esquemaOlvide, { correo: "no-es-correo" }));
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/correo válido/);
  });

  it("exige token y una contraseña de 8 a 128 caracteres", () => {
    expect(validar(esquemaRestablecer, { token: "abc", contrasena: "clave-segura-1" })).toEqual({ token: "abc", contrasena: "clave-segura-1" });
    expect(errorDe(() => validar(esquemaRestablecer, { token: "abc", contrasena: "1234567" })).message).toMatch(/al menos 8/);
    expect(errorDe(() => validar(esquemaRestablecer, { token: "abc", contrasena: "x".repeat(129) })).message).toMatch(/demasiado larga/);
    expect(errorDe(() => validar(esquemaRestablecer, { contrasena: "clave-segura-1" })).status).toBe(422);
  });
});
