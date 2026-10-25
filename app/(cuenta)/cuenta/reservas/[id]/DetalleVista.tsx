import type { DetalleReserva, PagoVista } from "@/lib/perfil/detalle";
import { formatearFechaHora } from "@/lib/perfil/textos";
import { formatearHoras, formatearSoles } from "@/lib/soles";
import { textoDeDireccion, textoDeServicio } from "../../PerfilVista";
import estilos from "../../cuenta.module.css";
import { AccionesReserva } from "./AccionesReserva";
import { FotosDelServicio } from "./FotosDelServicio";
import { ResenaDelServicio } from "./ResenaDelServicio";

export const TEXTO_SIN_CAMBIOS = "Ya no puedes cambiarla desde aquí. Escríbenos por WhatsApp.";

const CONCEPTO: Record<string, string> = { membresia: "Membresía Tiza Club", reserva: "Limpieza", membresia_y_reserva: "Membresía Tiza Club y limpieza" };
const METODO: Record<string, string> = { yape: "Yape", transferencia: "Transferencia", credito: "Crédito en horas" };
const ESTADO_PAGO: Record<string, string> = { pendiente: "En revisión", aprobado: "Aprobado", rechazado: "Rechazado" };

function BloqueDePago({ pago }: { pago: PagoVista }) {
  return (
    <section className={estilos.tarjeta} aria-label="Pago">
      <p className={estilos.tarjetaTitulo}>Pago</p>
      <p className={estilos.dato}>
        {CONCEPTO[pago.concepto] ?? pago.concepto}: {formatearSoles(pago.monto)} por {METODO[pago.metodo] ?? pago.metodo}
      </p>
      <p className={estilos.dato}>
        Estado: <span className={estilos.etiqueta}>{ESTADO_PAGO[pago.estado] ?? pago.estado}</span>
      </p>
      {pago.motivo_rechazo ? <p className={estilos.dato}>Motivo del rechazo: {pago.motivo_rechazo}</p> : null}
      {pago.comprobante ? (
        <p className={estilos.dato}>
          <a className={estilos.enlace} href={pago.comprobante} target="_blank" rel="noreferrer">
            Ver mi comprobante
          </a>
        </p>
      ) : null}
    </section>
  );
}

// `sinCambios`: la reserva sigue viva pero falta menos del plazo para cambiarla; la página lo calcula con `cancelacion_minima_horas`.
export function DetalleVista({ detalle, zona, whatsapp, sinCambios }: { detalle: DetalleReserva; zona: string; whatsapp: string | null; sinCambios: boolean }) {
  return (
    <>
      <a className={`${estilos.enlace} ${estilos.volver}`} href="/cuenta">
        Volver a mi cuenta
      </a>
      <h1 className={estilos.titulo}>{formatearFechaHora(detalle.inicio, zona)}</h1>
      <p className={estilos.subtitulo}>
        <span className={`${estilos.etiqueta} ${detalle.estado === "pendiente" ? estilos.etiquetaEspera : ""}`}>{detalle.estado_texto}</span>
        {detalle.expira_en ? <span className={estilos.mutado}> · hasta el {formatearFechaHora(detalle.expira_en, zona)}</span> : null}
      </p>

      <section className={estilos.tarjeta} aria-label="Servicio">
        <p className={estilos.tarjetaTitulo}>{textoDeServicio(detalle.servicio)}</p>
        <p className={estilos.dato}>{textoDeDireccion(detalle.direccion)}</p>
        {detalle.direccion.referencias ? <p className={estilos.dato}>Referencias: {detalle.direccion.referencias}</p> : null}
        {detalle.requiere_apoyo ? <p className={estilos.dato}>Esta limpieza lleva una persona de apoyo que coordinamos nosotros.</p> : null}
        <p className={estilos.dato}>Precio de lista: {formatearSoles(detalle.precio_lista)}</p>
        {detalle.horas_gratis_aplicadas > 0 ? <p className={estilos.dato}>Horas gratis: {formatearHoras(detalle.horas_gratis_aplicadas)}</p> : null}
        <p className={estilos.dato}>{detalle.monto > 0 ? `Total a pagar: ${formatearSoles(detalle.monto)}` : "Sin costo"}</p>
      </section>

      {detalle.pago ? <BloqueDePago pago={detalle.pago} /> : null}

      <FotosDelServicio estado={detalle.estado} fotos={detalle.fotos} />

      <ResenaDelServicio reservaId={detalle.id} resena={detalle.resena} puedeResenar={detalle.puede_resenar} />

      {detalle.puede_cancelar || detalle.puede_reprogramar ? (
        <AccionesReserva
          reservaId={detalle.id}
          puedeCancelar={detalle.puede_cancelar}
          puedeReprogramar={detalle.puede_reprogramar}
          requiereApoyo={detalle.requiere_apoyo}
          zona={zona}
        />
      ) : null}

      {sinCambios ? (
        <p className={estilos.aviso} role="note">
          {TEXTO_SIN_CAMBIOS}
          {whatsapp ? (
            <>
              {" "}
              <a className={estilos.enlace} href={whatsapp} target="_blank" rel="noreferrer">
                Abrir WhatsApp
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </>
  );
}
