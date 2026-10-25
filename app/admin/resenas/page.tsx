import { db } from "@/db/cliente";
import { errorOriginal } from "@/lib/agenda/errores-bd";
import { leerConfiguracion } from "@/lib/configuracion";
import { listarPendientes } from "@/lib/resenas/moderar";
import { conReintento } from "@/lib/reintento";
import { VistaResenas } from "./VistaResenas";

export const metadata = { title: "Reseñas por revisar · Tiza.com" };
export const dynamic = "force-dynamic";

// El rol admin lo exige `app/admin/layout.tsx`. Lee directo de la base (sin pasar por HTTP), con un reintento ante un corte.
export default async function Resenas() {
  const resenas = await conReintento(async () => {
    try {
      const { horario_atencion } = await leerConfiguracion();
      return await listarPendientes(db(), horario_atencion.zona);
    } catch (error) {
      throw errorOriginal(error);
    }
  });
  return <VistaResenas resenas={resenas} />;
}
