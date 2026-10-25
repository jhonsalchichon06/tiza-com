import { describe, expect, it } from "vitest";
import { leerEnv, leerEnvAuth, leerEnvBlob, leerEnvCorreo, leerEnvCron, leerEnvWhatsapp } from "./env";

describe("leerEnv", () => {
  it("nombra la variable que falta", () => {
    expect(() => leerEnv({})).toThrow(/DATABASE_URL/);
  });

  it("trata una variable vacía como faltante", () => {
    expect(() => leerEnv({ DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });

  it("devuelve la configuración cuando está completa", () => {
    expect(leerEnv({ DATABASE_URL: "postgres://x" }).DATABASE_URL).toBe("postgres://x");
  });
});

describe("leerEnvAuth", () => {
  const secreto = "x".repeat(32);

  it("nombra la variable que falta", () => {
    expect(() => leerEnvAuth({ BETTER_AUTH_URL: "http://localhost:3000" })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("rechaza un secreto de menos de 32 caracteres", () => {
    expect(() =>
      leerEnvAuth({ BETTER_AUTH_SECRET: "corto", BETTER_AUTH_URL: "http://localhost:3000" }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("usa BETTER_AUTH_URL cuando está definida", () => {
    expect(
      leerEnvAuth({ BETTER_AUTH_SECRET: secreto, BETTER_AUTH_URL: "https://tiza-com.vercel.app", VERCEL_URL: "x.vercel.app" })
        .BETTER_AUTH_URL,
    ).toBe("https://tiza-com.vercel.app");
  });

  it("usa VERCEL_URL como respaldo en los previews", () => {
    expect(leerEnvAuth({ BETTER_AUTH_SECRET: secreto, VERCEL_URL: "tiza-abc.vercel.app" }).BETTER_AUTH_URL).toBe(
      "https://tiza-abc.vercel.app",
    );
  });

  it("falla nombrando BETTER_AUTH_URL si no hay URL ni respaldo", () => {
    expect(() => leerEnvAuth({ BETTER_AUTH_SECRET: secreto })).toThrow(/BETTER_AUTH_URL/);
  });
});

describe("leerEnvCorreo", () => {
  it("nombra la variable que falta", () => {
    expect(() => leerEnvCorreo({ CORREO_REMITENTE: "Tiza <hola@tiza.com>" })).toThrow(/RESEND_API_KEY/);
    expect(() => leerEnvCorreo({ RESEND_API_KEY: "re_123" })).toThrow(/CORREO_REMITENTE/);
  });

  it("devuelve la clave y el remitente", () => {
    expect(leerEnvCorreo({ RESEND_API_KEY: "re_123", CORREO_REMITENTE: "Tiza <hola@tiza.com>" })).toEqual({
      RESEND_API_KEY: "re_123",
      CORREO_REMITENTE: "Tiza <hola@tiza.com>",
    });
  });
});

describe("leerEnvBlob", () => {
  it("nombra la variable que falta o está vacía", () => {
    expect(() => leerEnvBlob({})).toThrow(/BLOB_READ_WRITE_TOKEN/);
    expect(() => leerEnvBlob({ BLOB_READ_WRITE_TOKEN: "" })).toThrow(/BLOB_READ_WRITE_TOKEN/);
  });

  it("devuelve el token", () => {
    expect(leerEnvBlob({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x" })).toEqual({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x" });
  });
});

describe("leerEnvCron", () => {
  it("nombra la variable que falta", () => {
    expect(() => leerEnvCron({})).toThrow(/CRON_SECRET/);
  });

  it("rechaza un secreto de menos de 32 caracteres", () => {
    expect(() => leerEnvCron({ CRON_SECRET: "corto" })).toThrow(/CRON_SECRET/);
  });

  it("devuelve un secreto de 32 caracteres o más", () => {
    expect(leerEnvCron({ CRON_SECRET: "c".repeat(32) })).toEqual({ CRON_SECRET: "c".repeat(32) });
  });
});

describe("leerEnvWhatsapp", () => {
  it("devuelve el número si son solo dígitos", () => {
    expect(leerEnvWhatsapp({ WHATSAPP_NUMERO: "51912345678" })).toEqual({ WHATSAPP_NUMERO: "51912345678" });
  });

  it("devuelve null si falta, está vacío o no son solo dígitos, sin lanzar", () => {
    expect(leerEnvWhatsapp({})).toEqual({ WHATSAPP_NUMERO: null });
    expect(leerEnvWhatsapp({ WHATSAPP_NUMERO: "" })).toEqual({ WHATSAPP_NUMERO: null });
    expect(leerEnvWhatsapp({ WHATSAPP_NUMERO: "+51 912 345 678" })).toEqual({ WHATSAPP_NUMERO: null });
  });
});
