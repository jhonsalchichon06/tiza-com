// Compila y sirve la app apuntando a la rama de pruebas de Neon (el DATABASE_URL de .env.local es el de producción).
// Se usa `next start` y no `next dev`: la primera compilación de cada ruta en desarrollo es más lenta que los tiempos de espera.
require("dotenv").config({ path: ".env.local", quiet: true });
const { spawn, spawnSync } = require("child_process");

const pruebas = process.env.DATABASE_URL_PRUEBAS;
if (!pruebas || pruebas === process.env.DATABASE_URL) {
  console.error("DATABASE_URL_PRUEBAS falta o es igual a DATABASE_URL: no se arranca el servidor.");
  process.exit(1);
}
process.env.DATABASE_URL = pruebas;
const compilacion = spawnSync("npx next build", { stdio: "inherit", shell: true });
if (compilacion.status !== 0) process.exit(compilacion.status ?? 1);
const hijo = spawn("npx next start -p 3000", { stdio: "inherit", shell: true });
hijo.on("exit", (codigo) => process.exit(codigo ?? 0));
