import { db } from "@/db/cliente";
import { listarApoyoPorCoordinar } from "@/lib/admin/reservas/apoyo";
import { ejecutarPasadaDeExpiracion } from "@/lib/agenda/pasada";
import { errorOriginal } from "@/lib/agenda/errores-bd";
import { leerConfiguracion } from "@/lib/configuracion";
import { conReintento } from "@/lib/reintento";
import { VistaApoyo } from "./VistaApoyo";

export const metadata = { title: "Apoyo por coordinar · Tiza.com" };
export const dynamic = "force-dynamic";

// El rol admin lo exige `app/admin/layout.tsx`. La pasada de expiración corre antes de leer; la lista además ignora las
// esperas vencidas (`reservaActiva`), así que una reserva que expiró no aparece aunque la pasada no haya corrido.
export default async function Apoyo() {
  const apoyo = await conReintento(async () => {
    try {
      await ejecutarPasadaDeExpiracion();
      return await listarApoyoPorCoordinar(db(), await leerConfiguracion());
    } catch (error) {
      throw errorOriginal(error);
    }
  });
  return <VistaApoyo apoyo={apoyo} />;
}
