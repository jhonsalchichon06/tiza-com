import { expect, test } from "@playwright/test";
import { borrarRastrosDe } from "./limpieza";

// Un cliente nuevo se registra, paga la primera membresía con su primera limpieza gratis y ve la reserva en su perfil.
// Escribe en la rama `pruebas` de Neon y sube un comprobante al Blob; afterAll lo borra todo.
const correo = `e2e-${Date.now()}@tiza.test`;
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test.afterAll(async () => {
  await borrarRastrosDe(correo);
});

test("primera membresía: registro, reserva con comprobante y perfil", async ({ page }) => {
  await page.goto("/registro");
  await page.getByLabel("Nombre").fill("Cliente E2E");
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Celular").fill("900000000");
  await page.getByLabel("Contraseña").fill("clave-e2e-1234");
  const registro = page.waitForResponse((r) => r.url().endsWith("/api/sesion/registro"));
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  expect((await registro).status()).toBe(201);
  await expect(page).toHaveURL(/\/cuenta$/);

  await page.goto("/reservar");
  await page.getByRole("radio", { name: /Por horas/ }).check();
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByRole("radio", { name: /3 horas/ }).check();
  await page.getByRole("button", { name: "Continuar" }).click();

  // El octavo día de la lista queda a más de una semana: sobra para las 48 h de anticipación y cae dentro de los 3 meses.
  await page.getByRole("group", { name: "Elige el día (de lunes a sábado)" }).getByRole("button").nth(7).click();
  await page.getByRole("group", { name: /Elige la hora de llegada/ }).locator("button:not([disabled])").first().click();
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByLabel("Distrito").selectOption("San Borja");
  await page.getByLabel("Calle, avenida o jirón").fill("Avenida Javier Prado Este");
  await page.getByLabel("Número", { exact: true }).fill("1234");
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByRole("radio", { name: /Yape/ }).check();
  await expect(page.getByText("Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.").first()).toBeVisible();
  await page.getByLabel(/Sube la foto o la captura de tu comprobante/).setInputFiles({ name: "comprobante.png", mimeType: "image/png", buffer: PNG_1X1 });
  await expect(page.getByText("Comprobante subido.")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar mi reserva" }).click();

  await expect(page.getByRole("heading", { name: "¡Tu reserva está en espera!" })).toBeVisible();
  await expect(page.getByText(/Tu reserva quedó en espera hasta que revisemos el pago/)).toBeVisible();
  await expect(page.getByText("Pago en revisión")).toBeVisible();

  await page.goto("/cuenta");
  await expect(page.getByRole("heading", { name: "Hola, Cliente E2E" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Próximas limpiezas" })).toBeVisible();
  await expect(page.getByText(/Avenida Javier Prado Este 1234, San Borja/)).toBeVisible();
  await expect(page.getByText("Aún no eres miembro de Tiza Club")).toHaveCount(0);
});
