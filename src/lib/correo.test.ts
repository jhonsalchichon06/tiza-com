import { describe, expect, it, vi } from "vitest";
import { armarCorreoRestablecimiento, enviarConCliente } from "./correo";

const DATOS = { para: "ana@correo.com", nombre: "Ana", enlace: "https://tiza-com.vercel.app/restablecer?token=abc123" };
const REMITENTE = "Tiza <onboarding@resend.dev>";

describe("armarCorreoRestablecimiento", () => {
  it("está en español, con el enlace, el vencimiento de 1 hora y la nota de ignorarlo", () => {
    const { subject, text, html } = armarCorreoRestablecimiento(DATOS);
    expect(subject).toBe("Restablece tu contraseña de Tiza.com");
    for (const cuerpo of [text, html]) {
      expect(cuerpo).toContain(DATOS.enlace);
      expect(cuerpo).toMatch(/vence en 1 hora/);
      expect(cuerpo).toMatch(/ignora este correo/);
    }
  });

  it("escapa el nombre en el HTML", () => {
    expect(armarCorreoRestablecimiento({ ...DATOS, nombre: "<b>Ana</b>" }).html).not.toContain("<b>Ana</b>");
  });
});

describe("enviarConCliente", () => {
  it("envía desde el remitente configurado a la dirección de la cuenta", async () => {
    const send = vi.fn().mockResolvedValue({ error: null });
    await enviarConCliente({ emails: { send } }, REMITENTE, DATOS);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: REMITENTE, to: "ana@correo.com" }));
  });

  it("propaga el error de Resend", async () => {
    const send = vi.fn().mockResolvedValue({ error: { message: "dominio no verificado" } });
    await expect(enviarConCliente({ emails: { send } }, REMITENTE, DATOS)).rejects.toThrow(/dominio no verificado/);
  });
});
