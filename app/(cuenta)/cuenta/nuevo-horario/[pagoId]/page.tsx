import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { errorOriginal } from "@/lib/agenda/errores-bd";
import { ErrorApi } from "@/lib/errores";
import { leerNuevoHorario } from "@/lib/reservas/nuevo-horario-datos";
import { conReintento } from "@/lib/reintento";
import { usuarioActual } from "@/lib/sesion";
import { Marco } from "../../../../reservar/Marco";
import estilos from "../../../../reservar/reservar.module.css";
import { ElegirNuevoHorario } from "./ElegirNuevoHorario";

export const metadata = { title: "Elige tu nuevo día y hora · Tiza.com" };

// Se lee la sesión y la base en cada petición: nada de esto puede quedar en caché.
export const dynamic = "force-dynamic";

// Nuevo día y hora para un pago YA aprobado (aprobación tardía o cancelación del administrador). Lee con la misma función que
// `GET /api/pagos/[id]/nuevo-horario` (sin pasar por HTTP): un pago ajeno, inexistente o con id mal formado da la página de «no
// encontrada» y ningún dato de otro cliente. Un pago que no admite horario (ya usado, pendiente) o cuyas horas pasaron a
// crédito muestra su mensaje, sin selector de horarios.
export default async function NuevoHorario({ params }: { params: Promise<{ pagoId: string }> }) {
  const { pagoId } = await params;
  const usuario = await usuarioActual();
  if (!usuario) redirect(`/ingresar?volver=/cuenta/nuevo-horario/${encodeURIComponent(pagoId)}`);

  let datos;
  try {
    datos = await conReintento(async () => {
      try {
        return await leerNuevoHorario({ usuario, pagoId, ahora: new Date() });
      } catch (error) {
        throw error instanceof ErrorApi ? error : errorOriginal(error);
      }
    });
  } catch (error) {
    if (error instanceof ErrorApi && error.status === 404) notFound();
    if (error instanceof ErrorApi && (error.status === 409 || error.status === 422)) {
      return (
        <Marco>
          <h1 className={estilos.titulo}>Elige tu nuevo día y hora</h1>
          <p role="alert" className={estilos.error}>
            {error.message}
          </p>
          <div className={estilos.acciones}>
            <Link className={estilos.boton} href="/cuenta">
              Ir a mi cuenta
            </Link>
          </div>
        </Marco>
      );
    }
    throw error;
  }

  return (
    <Marco>
      <ElegirNuevoHorario pagoId={pagoId} datos={datos} />
    </Marco>
  );
}
