import { describe, expect, it, vi } from "vitest";
import { authEnMemoria, registrarConSesion } from "./__fixtures__/auth";
import { obtenerUsuario, requerirAdmin, requerirSesion } from "./sesion";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

describe("sesion", () => {
  it("devuelve el usuario sin contraseña cuando hay sesión", async () => {
    const { auth } = authEnMemoria();
    const cabeceras = await registrarConSesion(auth);
    expect(await obtenerUsuario(cabeceras, auth)).toEqual({
      id: expect.any(String),
      correo: "ana@correo.com",
      nombre: "Ana",
      celular: "987654321",
      rol: "cliente",
    });
  });

  it("requerirSesion responde 401 sin cookie", async () => {
    const { auth } = authEnMemoria();
    await expect(requerirSesion(new Headers(), auth)).rejects.toMatchObject({ status: 401 });
  });

  it("requerirSesion responde 401 con una cookie inventada", async () => {
    const { auth } = authEnMemoria();
    const falsa = new Headers({ cookie: "better-auth.session_token=inventado.firma" });
    await expect(requerirSesion(falsa, auth)).rejects.toMatchObject({ status: 401 });
  });

  it("requerirAdmin responde 401 sin sesión y 403 a un cliente", async () => {
    const { auth } = authEnMemoria();
    await expect(requerirAdmin(new Headers(), auth)).rejects.toMatchObject({ status: 401 });
    const cabeceras = await registrarConSesion(auth);
    await expect(requerirAdmin(cabeceras, auth)).rejects.toMatchObject({ status: 403 });
  });

  it("requerirAdmin deja pasar a un admin y deja de hacerlo en cuanto se le retira el rol", async () => {
    const { auth, datos } = authEnMemoria();
    const cabeceras = await registrarConSesion(auth);
    datos.usuarios[0].rol = "admin";
    await expect(requerirAdmin(cabeceras, auth)).resolves.toMatchObject({ rol: "admin" });
    datos.usuarios[0].rol = "cliente";
    await expect(requerirAdmin(cabeceras, auth)).rejects.toMatchObject({ status: 403 });
  });
});
