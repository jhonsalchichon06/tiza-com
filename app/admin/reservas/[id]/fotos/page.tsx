import { notFound } from "next/navigation";
import { errorOriginal } from "@/lib/agenda/errores-bd";
import { ErrorApi } from "@/lib/errores";
import { leerPantallaFotos } from "@/lib/fotos/pantalla";
import { conReintento } from "@/lib/reintento";
import { VistaFotos } from "./VistaFotos";

export const metadata = { title: "Fotos del servicio · Tiza.com" };
export const dynamic = "force-dynamic";

// El rol admin lo exige `app/admin/layout.tsx`. Lee con las mismas funciones que la ruta de registro, sin pasar por HTTP. Un id
// que no es uuid o una reserva que no existe dan la página de «no encontrada». Neon dormido: un reintento (el error de Drizzle
// se desenvuelve para que `conReintento` reconozca el corte de conexión).
export default async function FotosDeReserva({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const datos = await conReintento(async () => {
    try {
      return await leerPantallaFotos(id);
    } catch (error) {
      throw error instanceof ErrorApi ? error : errorOriginal(error);
    }
  });
  if (!datos) notFound();
  return <VistaFotos datos={datos} />;
}
