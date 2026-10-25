import { db } from "@/db/cliente";
import { contarPendientes } from "@/lib/resenas/moderar";
import { VistaAdmin } from "./VistaAdmin";

export const metadata = { title: "Portal de administración · Tiza.com" };
export const dynamic = "force-dynamic";

// Portada del portal (enlaces en `VistaAdmin`). Cuenta las reseñas por revisar (ítem 18); si el conteo falla, el enlace sale sin
// número: la portada no depende de él.
export default async function Admin() {
  let pendientes: number | null = null;
  try {
    pendientes = await contarPendientes(db());
  } catch (error) {
    console.error("No se pudieron contar las reseñas por revisar:", error);
  }
  return <VistaAdmin pendientesResenas={pendientes} />;
}
