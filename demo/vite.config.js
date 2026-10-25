import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// La demo vive en demo/ y se levanta desde la raíz con `vite demo`:
// las entradas se resuelven respecto de esta carpeta, no del directorio actual.
const aqui = (archivo) => fileURLToPath(new URL(archivo, import.meta.url));

export default defineConfig({
  server: { port: 5173, open: true },
  build: {
    rollupOptions: {
      input: { index: aqui("index.html"), reservar: aqui("reservar.html"), cuenta: aqui("cuenta.html") },
    },
  },
});
