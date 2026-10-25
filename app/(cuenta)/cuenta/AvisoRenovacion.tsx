import type { Renovacion } from "@/lib/membresia/renovacion";
import estilos from "./cuenta.module.css";

// Aviso de renovación del mes 4 (renovacion-del-mes-4). Los textos y el plan los escribe el servidor; aquí solo se muestran.
// `renovacion_rechazada` NO se pinta aquí: su motivo, los días que quedan y el formulario para subir otro comprobante
// salen del aviso `pago_rechazado` del perfil (definición única de «puede subir otro comprobante», ítem 11).
export function AvisoRenovacion({ renovacion }: { renovacion: Renovacion }) {
  if (renovacion.estado === "no_aplica" || renovacion.estado === "renovacion_rechazada") return null;
  const atencion = renovacion.estado === "vencida";
  return (
    <section aria-label="Renovación de la membresía">
      <div role="status" className={`${estilos.aviso} ${atencion ? estilos.avisoAtencion : ""}`} data-renovacion={renovacion.estado}>
        <p className={estilos.avisoTexto}>{renovacion.texto}</p>
        {renovacion.estado === "vencida" ? (
          <div className={estilos.acciones}>
            <a className={estilos.boton} href="/cuenta/renovar">
              Renovar mi membresía
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
