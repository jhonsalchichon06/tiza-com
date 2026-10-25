// Compuerta de despliegue a producción (DEPLOY-PLAN.md, opción A).
// Uso: npm run desplegar
// Comprueba el árbol de Git, corre tipos, pruebas y build, y solo entonces pide autorización
// para migrar y para desplegar. Cada acción sobre producción exige escribir la palabra pedida.
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { config } from "dotenv";

const URL_PRODUCCION = "https://tiza-com.vercel.app";

function ejecutar(comando, { capturar = false } = {}) {
  const r = spawnSync(comando, { shell: true, stdio: capturar ? "pipe" : "inherit", encoding: "utf8" });
  return { codigo: r.status ?? 1, salida: (r.stdout ?? "").trim() };
}

function abortar(mensaje) {
  console.error(`\n✖ ${mensaje}`);
  process.exit(1);
}

function exigir(comando, etiqueta) {
  console.log(`\n▶ ${etiqueta}`);
  if (ejecutar(comando).codigo !== 0) abortar(`Falló: ${etiqueta}. No se despliega nada.`);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
async function autorizar(palabra, pregunta) {
  const respuesta = (await rl.question(`\n${pregunta}\nEscribe "${palabra}" para continuar: `)).trim();
  return respuesta === palabra;
}

// 1. Trazabilidad: todo confirmado y etiquetado.
if (ejecutar("git status --porcelain", { capturar: true }).salida !== "") {
  abortar("Hay cambios sin confirmar. Confirma el trabajo en un commit antes de desplegar.");
}
const sha = ejecutar("git rev-parse --short HEAD", { capturar: true }).salida;
const etiqueta = ejecutar("git describe --exact-match --tags HEAD", { capturar: true });
if (etiqueta.codigo !== 0) abortar(`El commit ${sha} no tiene etiqueta. Crea una: git tag v<fecha> ${sha}`);
console.log(`Commit ${sha}, etiqueta ${etiqueta.salida}`);

// 2. Compuerta técnica.
exigir("npm run typecheck", "Tipos (tsc --noEmit)");
exigir("npm test", "Pruebas unitarias");
exigir("npm run build", "Build de producción");
console.log("\n✔ Compuerta superada.");

// 3. Migraciones de PRODUCCIÓN (opcionales, con autorización propia).
// .env.local apunta a la rama de desarrollo: la cadena de producción se pasa a propósito con
// DATABASE_URL_PRODUCCION o con un archivo .env.produccion (ignorado por Git).
config({ path: ".env.produccion", quiet: true });
const urlProduccion = process.env.DATABASE_URL_PRODUCCION;
if (!urlProduccion) {
  console.log("\nSin DATABASE_URL_PRODUCCION (ni .env.produccion): no se ofrecen migraciones de producción.");
} else {
  let host = "desconocido";
  try {
    host = new URL(urlProduccion).hostname;
  } catch {}
  console.log(`\nBase de PRODUCCIÓN: ${host}`);
  console.log("Antes de migrar: toma la instantánea/rama de Neon de respaldo (DEPLOY-PLAN.md, 2.7).");
  if (await autorizar("migrar", "¿Aplicar las migraciones pendientes a la base de PRODUCCIÓN? (Cualquier otra respuesta las omite.)")) {
    process.env.DATABASE_URL = urlProduccion; // dotenv no sobrescribe: drizzle.config usa este valor
    exigir("npm run db:migrate", "Migraciones de Drizzle en producción");
  } else {
    console.log("Migraciones omitidas.");
  }
}

// 4. Despliegue.
if (!(await autorizar("desplegar", `¿Desplegar ${etiqueta.salida} (${sha}) a PRODUCCIÓN?`))) {
  rl.close();
  abortar("Despliegue cancelado.");
}
rl.close();
exigir(
  `npx vercel deploy --prod --meta gitCommit=${sha} --meta gitTag=${etiqueta.salida}`,
  "Despliegue a producción",
);

// 5. Verificación.
console.log(`\n▶ Verificación: GET ${URL_PRODUCCION}/api/salud`);
let sano = false;
try {
  const r = await fetch(`${URL_PRODUCCION}/api/salud`);
  const cuerpo = await r.json().catch(() => ({}));
  sano = r.status === 200 && cuerpo.estado === "ok";
  console.log(`Respuesta: ${r.status} ${JSON.stringify(cuerpo)}`);
} catch (e) {
  console.log(`Sin respuesta: ${e.message}`);
}
if (!sano) {
  console.error("\n✖ El despliegue NO pasó la verificación. Considera el rollback (se ejecuta a mano):");
  console.error("    npx vercel ls            # elige el último despliegue Ready anterior");
  console.error("    npx vercel rollback <url>");
  process.exit(1);
}
console.log("\n✔ /api/salud responde ok. Falta el humo manual de DEPLOY-PLAN.md, 2.9 (puntos 2 a 4).");
