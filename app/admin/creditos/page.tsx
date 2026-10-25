import { db } from "@/db/cliente";
import { ejecutarPasadaDeExpiracion } from "@/lib/agenda/pasada";
import { errorOriginal } from "@/lib/agenda/errores-bd";
import { leerConfiguracion } from "@/lib/configuracion";
import { listarCreditosAdmin } from "@/lib/creditos/consulta";
import { conReintento } from "@/lib/reintento";
import { VistaCreditos } from "./VistaCreditos";

export const metadata = { title: "Crédito en horas · Tiza.com" };
export const dynamic = "force-dynamic";

// El rol admin lo exige `app/admin/layout.tsx`. Lee con las mismas funciones que `GET /api/admin/creditos` (sin pasar por HTTP):
// la pasada de expiración corre antes para que las horas de las reservas vencidas ya estén de vuelta en su lote.
export default async function Creditos() {
  const { clientes, zona } = await conReintento(async () => {
    try {
      await ejecutarPasadaDeExpiracion();
      const zona = (await leerConfiguracion()).horario_atencion.zona;
      return { clientes: await listarCreditosAdmin(db(), zona), zona };
    } catch (error) {
      throw errorOriginal(error);
    }
  });
  return <VistaCreditos clientes={clientes} zona={zona} />;
}
