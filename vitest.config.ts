import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts", "app/**/*.test.ts"],
    // Las pruebas contra Neon (`*.bd.test.ts`) tienen su propia configuración: `npm test` nunca abre una conexión.
    exclude: [...configDefaults.exclude, "**/*.bd.test.ts"],
  },
});
