import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { leerEnv } from "@/lib/env";
import * as esquema from "./esquema";

// Un solo driver (WebSocket) para lecturas y transacciones interactivas (ADR 0009).
neonConfig.webSocketConstructor = ws;

let instancia: ReturnType<typeof crear> | undefined;

function crear() {
  const pool = new Pool({ connectionString: leerEnv().DATABASE_URL });
  return drizzle(pool, { schema: esquema });
}

// Perezoso: `next build` no necesita DATABASE_URL.
export function db() {
  return (instancia ??= crear());
}
