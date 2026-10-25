import { notFound, redirect } from "next/navigation";
import { leerEnvWhatsapp } from "@/lib/env";
import { ErrorApi } from "@/lib/errores";
import { leerDetalleConZona } from "@/lib/perfil/detalle";
import { usuarioActual } from "@/lib/sesion";
import { enlaceWhatsapp, mensajeDeCambioUrgente } from "@/lib/reservas/whatsapp";
import estilos from "../../cuenta.module.css";
import { DetalleVista } from "./DetalleVista";

export const metadata = { title: "Mi reserva · Tiza.com" };

// Detalle de una reserva del cliente. Lee con la misma función que `GET /api/reservas/[id]` (sin pasar por HTTP): una reserva
// ajena, inexistente o con id mal formado da la página de «no encontrada» y ningún dato de otro cliente.
export default async function DetalleDeReserva({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const usuario = await usuarioActual();
  if (!usuario) redirect(`/ingresar?volver=/cuenta/reservas/${encodeURIComponent(id)}`);

  const ahora = new Date();
  let lectura;
  try {
    lectura = await leerDetalleConZona({ usuario, reservaId: id, ahora });
  } catch (error) {
    if (error instanceof ErrorApi && error.status === 404) notFound();
    throw error;
  }
  const { detalle, zona } = lectura;

  // Si la reserva sigue viva pero ya no se puede cambiar desde aquí (falta poco), se ofrece el enlace de WhatsApp.
  const sinCambios = (detalle.estado === "pendiente" || detalle.estado === "confirmada") && new Date(detalle.inicio).getTime() > ahora.getTime() && !detalle.puede_cancelar;
  const whatsapp = sinCambios
    ? enlaceWhatsapp({
        numero: leerEnvWhatsapp().WHATSAPP_NUMERO,
        mensaje: mensajeDeCambioUrgente({
          nombre: usuario.nombre,
          celular: usuario.celular,
          accion: "cambiar",
          servicio: detalle.servicio.tipo === "paquete" ? { tipo: "paquete", horas: detalle.servicio.horas } : { tipo: detalle.servicio.tipo },
          inicio: new Date(detalle.inicio),
          zona,
          distrito: detalle.direccion.distrito,
          calle: detalle.direccion.calle,
          numero: detalle.direccion.numero,
          departamento: detalle.direccion.departamento,
        }),
      })
    : null;

  return (
    <main className={estilos.pagina}>
      <div className={estilos.contenido}>
        <DetalleVista detalle={detalle} zona={zona} whatsapp={whatsapp} sinCambios={sinCambios} />
      </div>
    </main>
  );
}
