import { db } from "@/db/cliente";
import { ejecutarPasadaDeExpiracion } from "@/lib/agenda/pasada";
import { errorOriginal } from "@/lib/agenda/errores-bd";
import { leerConfiguracion } from "@/lib/configuracion";
import { listarPagos } from "@/lib/pagos/listado";
import { conReintento } from "@/lib/reintento";
import { VistaListaPagos } from "./VistaListaPagos";

export const metadata = { title: "Pagos por revisar · Tiza.com" };
export const dynamic = "force-dynamic";

// El rol admin lo exige `app/admin/layout.tsx`. La pasada de expiración corre antes de leer: la lista nunca muestra como
// pendiente una reserva cuya espera ya venció (design de revision-de-pagos-admin, decisión 5). Drizzle envuelve los errores
// de conexión: se desenvuelven para que `conReintento` los reconozca.
export default async function PagosPorRevisar() {
  const pagos = await conReintento(async () => {
    try {
      await ejecutarPasadaDeExpiracion();
      return await listarPagos(db(), { estado: "pendiente" }, await leerConfiguracion());
    } catch (error) {
      throw errorOriginal(error);
    }
  });
  return <VistaListaPagos pagos={pagos} />;
}
