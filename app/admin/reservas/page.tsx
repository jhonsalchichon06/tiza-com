import { db } from "@/db/cliente";
import { listarReservas } from "@/lib/admin/reservas/listado";
import { ejecutarPasadaDeExpiracion } from "@/lib/agenda/pasada";
import { errorOriginal } from "@/lib/agenda/errores-bd";
import { leerConfiguracion } from "@/lib/configuracion";
import { ErrorApi } from "@/lib/errores";
import { conReintento } from "@/lib/reintento";
import { VistaReservas } from "./VistaReservas";

export const metadata = { title: "Reservas · Tiza.com" };
export const dynamic = "force-dynamic";

// El rol admin lo exige `app/admin/layout.tsx`. La pasada de expiración corre antes de leer; además la lista calcula el
// estado efectivo, así que nunca muestra como pendiente una espera vencida. Un `?estado=` inválido se trata como «sin
// filtro» (la pantalla no muestra errores de URL); la API sí responde 422.
export default async function Reservas({ searchParams }: { searchParams: Promise<{ estado?: string | string[] }> }) {
  const { estado } = await searchParams;
  const pedido = typeof estado === "string" ? estado : null;
  const leer = (filtro: string | null) =>
    conReintento(async () => {
      try {
        await ejecutarPasadaDeExpiracion();
        return await listarReservas(db(), { estado: filtro }, await leerConfiguracion());
      } catch (error) {
        throw error instanceof ErrorApi ? error : errorOriginal(error);
      }
    });
  let filtro = pedido;
  let datos;
  try {
    datos = await leer(filtro);
  } catch (error) {
    if (!(error instanceof ErrorApi && error.status === 422)) throw error;
    filtro = null;
    datos = await leer(null);
  }
  return <VistaReservas datos={datos} filtro={filtro} />;
}
