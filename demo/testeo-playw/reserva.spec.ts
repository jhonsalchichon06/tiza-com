import { test, expect } from '@playwright/test';

test('reserva de limpieza estándar por pasos hasta la confirmación', async ({ page }) => {
  await page.goto('/reservar.html');

  // Paso 1: servicio (avanza solo)
  await page.getByRole('button', { name: /Limpieza estándar/ }).click();

  // Paso 2: distrito + dormitorios
  await page.getByLabel('Distrito').selectOption('Miraflores');
  await page.getByRole('button', { name: '+' }).first().click();
  await expect(page.locator('#sum')).toContainText('3 dorm. · 1 baño');
  await page.getByRole('button', { name: 'Continuar →' }).click();

  // Paso 3: día y hora. El segundo día de la lista siempre cumple las 48 h de anticipación;
  // en el primero, las primeras horas pueden estar en gris según la hora en que corre la prueba.
  await page.locator('#days button').nth(1).click();
  await page.getByRole('button', { name: '10:00 am' }).click();
  await page.getByRole('button', { name: 'Continuar →' }).click();

  // Paso 4: datos de contacto
  await page.getByLabel('Nombre').fill('Camila Test');
  await page.getByLabel('WhatsApp').fill('987654321');
  await page.getByLabel('Dirección').fill('Av. Larco 123');
  await page.getByRole('button', { name: 'Continuar →' }).click();

  // Paso 5: pago simulado con comprobante
  await page.getByRole('button', { name: 'Yape' }).click();
  await expect(page.getByRole('img', { name: 'Código QR de demostración' })).toBeVisible();
  await page.getByLabel(/Comprobante/).setInputFiles({ name: 'comprobante.png', mimeType: 'image/png', buffer: Buffer.from('png de prueba') });
  await page.getByRole('button', { name: 'Confirmar reserva ✓' }).click();

  // Resultado visible
  await expect(page.getByRole('heading', { name: '¡Casi listo, Camila!' })).toBeVisible();
  const wa = page.getByRole('link', { name: 'Abrir WhatsApp' });
  await expect(wa).toBeVisible();
  await expect(wa).toHaveAttribute('href', /wa\.me\/.*Miraflores/);
});
