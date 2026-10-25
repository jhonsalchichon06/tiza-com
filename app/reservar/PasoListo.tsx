import Link from "next/link";
import { describirDia } from "@/lib/reservas/asistente/dias";
import type { DireccionEscrita } from "@/lib/reservas/asistente/estado";
import type { RespuestaDeReserva } from "@/lib/reservas/crear";
import { NOMBRES_DE_SERVICIO } from "@/lib/reservas/asistente/nombres";
import { formatearHoras, formatearSoles } from "@/lib/soles";
import { AvisoDemostracion } from "./AvisoDemostracion";
import estilos from "./reservar.module.css";

type Props = {
  respuesta: RespuestaDeReserva;
  direccion: DireccionEscrita;
  esperaHoras: number; // plazo de revisión que dio la cotización
};

// `inicio` viene del servidor con la hora de Lima escrita en el texto: se lee tal cual, sin pasar por el reloj del dispositivo.
const diaDe = (iso: string) => describirDia(iso.slice(0, 10));
const horaDe = (iso: string) => iso.slice(11, 16);

export function PasoListo({ respuesta, direccion, esperaHoras }: Props) {
  const { reserva, pago, whatsapp } = respuesta;
  const nombreServicio =
    reserva.servicio.tipo === "paquete" ? `Paquete de ${formatearHoras(reserva.servicio.horas)}` : NOMBRES_DE_SERVICIO[reserva.servicio.tipo];
  // Una limpieza sin costo (o ya pagada) nace confirmada: no hay un pago en revisión que esperar.
  const confirmada = reserva.estado === "confirmada";
  const lineaDireccion = [`${direccion.calle} ${direccion.numero}`, direccion.departamento.trim(), direccion.distrito].filter(Boolean).join(", ");

  return (
    <div>
      {confirmada ? (
        <p className={estilos.subtitulo}>Tu limpieza quedó confirmada. Te esperamos el día y la hora que elegiste.</p>
      ) : (
        <p className={estilos.subtitulo}>
          Tu reserva quedó en espera hasta que revisemos el pago (máximo {formatearHoras(esperaHoras)}). Cuando lo aprobemos, tu limpieza queda
          confirmada.
        </p>
      )}

      <dl className={estilos.resumen} aria-label="Resumen de tu reserva">
        <div className={estilos.resumenFila}>
          <dt>Servicio</dt>
          <dd>{nombreServicio}</dd>
        </div>
        <div className={estilos.resumenFila}>
          <dt>Día y hora</dt>
          <dd>
            {diaDe(reserva.inicio)}, {horaDe(reserva.inicio)}
          </dd>
        </div>
        <div className={estilos.resumenFila}>
          <dt>Dirección</dt>
          <dd>{lineaDireccion}</dd>
        </div>
        {confirmada ? null : (
          <div className={estilos.resumenFila}>
            <dt>Pago en revisión</dt>
            <dd>{formatearSoles(pago.monto)}</dd>
          </div>
        )}
      </dl>

      <AvisoDemostracion />

      <div className={estilos.acciones}>
        {whatsapp ? (
          <a className={`${estilos.boton} ${estilos.botonWhatsapp}`} href={whatsapp} target="_blank" rel="noopener noreferrer">
            Coordinar por WhatsApp
          </a>
        ) : null}
        <Link className={`${estilos.boton} ${estilos.botonSecundario}`} href="/cuenta">
          Ir a mi cuenta
        </Link>
      </div>
    </div>
  );
}
