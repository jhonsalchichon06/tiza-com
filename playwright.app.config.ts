import { defineConfig, devices } from '@playwright/test';

// Pruebas end-to-end de la app Next.js (puerto 3000), siempre contra la rama de Neon `pruebas`.
// La demo en demo/ tiene su propia configuración: playwright.config.ts.
const URL = 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 180_000,
  // Desde un equipo local, cada consulta a Neon (São Paulo) suma latencia: /cuenta y /reservar tardan de 7 a 9 s en abrir.
  expect: { timeout: 30_000 },
  use: {
    baseURL: URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/servidor-pruebas.cjs',
    url: `${URL}/api/salud`,
    // Nunca reutilizar: un `npm run dev` ya abierto apuntaría a la base de producción.
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
