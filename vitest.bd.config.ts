import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Pruebas contra Neon real (restricción de exclusión, expiración y concurrencia).
// Se ejecutan a mano: PRUEBAS_BD=1 npx vitest run --config vitest.bd.config.ts
// Usan DATABASE_URL_PRUEBAS (rama de Neon) si existe; si no, DATABASE_URL, que es la de producción.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.bd.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
