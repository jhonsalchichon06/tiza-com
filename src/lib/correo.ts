import { Resend } from "resend";
import { leerEnvCorreo } from "./env";

export type CorreoRestablecimiento = { para: string; nombre: string; enlace: string };

// Lo mínimo que usamos del cliente de Resend; permite probar sin red.
export type ClienteCorreo = {
  emails: {
    send(datos: { from: string; to: string; subject: string; text: string; html: string }): Promise<{
      error: { message: string } | null;
    }>;
  };
};

const escapar = (texto: string) =>
  texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function armarCorreoRestablecimiento({ nombre, enlace }: Pick<CorreoRestablecimiento, "nombre" | "enlace">) {
  const subject = "Restablece tu contraseña de Tiza.com";
  const text = [
    `Hola, ${nombre}:`,
    "",
    "Recibimos una solicitud para restablecer la contraseña de tu cuenta de Tiza.com.",
    "Para elegir una contraseña nueva, abre este enlace:",
    enlace,
    "",
    "El enlace vence en 1 hora y solo se puede usar una vez.",
    "Si no lo pediste tú, ignora este correo: tu contraseña no cambiará.",
  ].join("\n");
  const html = `<p>Hola, ${escapar(nombre)}:</p>
<p>Recibimos una solicitud para restablecer la contraseña de tu cuenta de Tiza.com. Para elegir una contraseña nueva, usa este enlace:</p>
<p><a href="${escapar(enlace)}">Restablecer mi contraseña</a></p>
<p>El enlace vence en 1 hora y solo se puede usar una vez.</p>
<p>Si no lo pediste tú, ignora este correo: tu contraseña no cambiará.</p>`;
  return { subject, text, html };
}

export async function enviarConCliente(
  cliente: ClienteCorreo,
  remitente: string,
  { para, nombre, enlace }: CorreoRestablecimiento,
): Promise<void> {
  const { error } = await cliente.emails.send({ from: remitente, to: para, ...armarCorreoRestablecimiento({ nombre, enlace }) });
  if (error) throw new Error(`Resend no envió el correo de restablecimiento: ${error.message}`);
}

// Perezoso, como db(): `next build` no necesita las variables de Resend.
export function enviarCorreoRestablecimiento(datos: CorreoRestablecimiento): Promise<void> {
  const env = leerEnvCorreo();
  return enviarConCliente(new Resend(env.RESEND_API_KEY), env.CORREO_REMITENTE, datos);
}
