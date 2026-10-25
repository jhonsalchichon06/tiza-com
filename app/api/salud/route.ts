import { sql } from "drizzle-orm";
import { db } from "@/db/cliente";
import { manejar } from "@/lib/errores";
import { conReintento } from "@/lib/reintento";

// Confirma que la app está en pie y llega a la base; sirve para verificar cada despliegue.
export const GET = manejar(async () => {
  await conReintento(() => db().execute(sql`select 1`));
  return Response.json({ estado: "ok" });
});
