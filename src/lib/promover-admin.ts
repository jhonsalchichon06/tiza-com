import { eq } from "drizzle-orm";
import { db } from "@/db/cliente";
import { usuarios } from "@/db/esquema";

// Marca como admin la cuenta con ese correo; devuelve false si no existe (no crea nada).
type Promover = (correo: string) => Promise<boolean>;

export const promoverEnBase: Promover = async (correo) => {
  const filas = await db()
    .update(usuarios)
    .set({ rol: "admin", updatedAt: new Date() })
    .where(eq(usuarios.email, correo))
    .returning({ id: usuarios.id });
  return filas.length > 0;
};

export async function promoverAdmin(correoEscrito: string, promover: Promover = promoverEnBase): Promise<string> {
  const correo = correoEscrito.trim().toLowerCase();
  if (!correo) throw new Error("Indica el correo de la cuenta: npm run admin:promover -- <correo>");
  if (!(await promover(correo))) throw new Error(`No existe una cuenta con el correo ${correo}. Regístrala primero en /registro.`);
  return correo;
}
