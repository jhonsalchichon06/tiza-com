import { notFound } from "next/navigation";
import { db } from "@/db/cliente";
import { ejecutarPasadaDeExpiracion } from "@/lib/agenda/pasada";
import { errorOriginal } from "@/lib/agenda/errores-bd";
import { leerConfiguracion } from "@/lib/configuracion";
import { detalleCreditosAdmin } from "@/lib/creditos/consulta";
import { ErrorApi } from "@/lib/errores";
import { conReintento } from "@/lib/reintento";
import { VistaCreditosDeCliente } from "../VistaCreditos";

export const metadata = { title: "Crédito de un cliente · Tiza.com" };
export const dynamic = "force-dynamic";

// El rol admin lo exige `app/admin/layout.tsx`. Un cliente que no existe responde 404 (el id de Better Auth es texto).
export default async function CreditosDeCliente({ params }: { params: Promise<{ usuarioId: string }> }) {
  const { usuarioId } = await params;
  let resultado;
  try {
    resultado = await conReintento(async () => {
      try {
        await ejecutarPasadaDeExpiracion();
        const zona = (await leerConfiguracion()).horario_atencion.zona;
        return { detalle: await detalleCreditosAdmin(db(), usuarioId, zona), zona };
      } catch (error) {
        throw error instanceof ErrorApi ? error : errorOriginal(error);
      }
    });
  } catch (error) {
    if (error instanceof ErrorApi && error.status === 404) notFound();
    throw error;
  }
  return <VistaCreditosDeCliente detalle={resultado.detalle} zona={resultado.zona} />;
}
