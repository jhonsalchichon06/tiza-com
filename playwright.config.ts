import { defineConfig, devices } from '@playwright/test';

// Vite sirve la demo en el puerto 5173 (ver demo/vite.config.js).
const URL = 'http://localhost:5173';

export default defineConfig({
  testDir: './demo/testeo-playw',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // --open false: demo/vite.config.js tiene open: true y abriría una ventana extra
    command: 'npm run demo:dev -- --open false',
    url: URL,
    reuseExistingServer: true,
  },
});
