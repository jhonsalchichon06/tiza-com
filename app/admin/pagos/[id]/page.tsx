import { notFound } from "next/navigation";
import { db } from "@/db/cliente";
import { ejecutarPasadaDeExpiracion } from "@/lib/agenda/pasada";
import { errorOriginal } from "@/lib/agenda/errores-bd";
import { leerConfiguracion } from "@/lib/configuracion";
import { ErrorApi } from "@/lib/errores";
import { detalleDePago } from "@/lib/pagos/listado";
import { conReintento } from "@/lib/reintento";
import { VistaDetallePago } from "./VistaDetallePago";

export const metadata = { title: "Revisar pago · Tiza.com" };
export const dynamic = "force-dynamic";

// El rol admin lo exige `app/admin/layout.tsx`. Un id que no es uuid o que no existe es un 404, no un error.
export default async function RevisarPago({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const detalle = await conReintento(async () => {
      try {
        await ejecutarPasadaDeExpiracion();
        return await detalleDePago(db(), id, await leerConfiguracion());
      } catch (error) {
        throw error instanceof ErrorApi ? error : errorOriginal(error);
      }
    });
    return <VistaDetallePago detalle={detalle} />;
  } catch (error) {
    if (error instanceof ErrorApi && error.status === 404) notFound();
    throw error;
  }
}
