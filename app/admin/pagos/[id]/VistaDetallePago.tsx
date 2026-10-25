import Link from "next/link";
import type { DetalleDePago } from "@/lib/pagos/listado";
import { formatearHoras, formatearSoles } from "@/lib/soles";
import { CONCEPTOS, ESTADOS_DE_RESERVA, METODOS, NIVELES, TIPOS_DE_SERVICIO, fechaYHora } from "../formato";
import estilos from "../pagos.module.css";
import { AccionesPago } from "./AccionesPago";

// Un pago con su comprobante, su reserva y las direcciones parecidas que ya recibieron la limpieza gratis. Los botones
// solo aparecen mientras el pago está `pendiente`.
export function VistaDetallePago({ detalle }: { detalle: DetalleDePago }) {
  const { pago, cliente, membresia, reserva, coincidencias, comprobante } = detalle;
  const direccion = reserva ? [`${reserva.calle} ${reserva.numero}`, reserva.departamento, reserva.distrito].filter(Boolean).join(", ") : null;

  return (
    <main className={estilos.pagina}>
      <Link href="/admin/pagos" className={estilos.volver}>
        ← Pagos por revisar
      </Link>
      <h1 className={estilos.titulo}>Pago de {cliente.nombre}</h1>
      <p className={estilos.ayuda}>
        {cliente.correo} · {cliente.celular}
      </p>

      <section className={estilos.tarjeta}>
        <h2>Pago</h2>
        <dl className={estilos.datos}>
          <dt>Concepto</dt>
          <dd>{CONCEPTOS[pago.concepto] ?? pago.concepto}</dd>
          <dt>Monto</dt>
          <dd>{formatearSoles(pago.monto)}</dd>
          <dt>Método</dt>
          <dd>{METODOS[pago.metodo] ?? pago.metodo}</dd>
          <dt>Estado</dt>
          <dd>{pago.estado}</dd>
          <dt>Enviado</dt>
          <dd>{fechaYHora(pago.creado_en)}</dd>
          {membresia ? (
            <>
              <dt>Membresía</dt>
              <dd>{membresia.estado}</dd>
            </>
          ) : null}
          {pago.reemplaza_a ? (
            <>
              <dt>Comprobante</dt>
              <dd>Reemplaza a uno rechazado</dd>
            </>
          ) : null}
          {pago.motivo_rechazo ? (
            <>
              <dt>Motivo del rechazo</dt>
              <dd>{pago.motivo_rechazo}</dd>
            </>
          ) : null}
          {pago.reenvio_hasta ? (
            <>
              <dt>Puede reenviar hasta</dt>
              <dd>{fechaYHora(pago.reenvio_hasta)}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className={estilos.tarjeta}>
        <h2>Reserva</h2>
        {reserva ? (
          <dl className={estilos.datos}>
            <dt>Servicio</dt>
            <dd>{TIPOS_DE_SERVICIO[reserva.tipo] ?? reserva.tipo}</dd>
            <dt>Fecha y hora</dt>
            <dd>{fechaYHora(reserva.inicio)}</dd>
            <dt>Dirección</dt>
            <dd>{direccion}</dd>
            <dt>Estado</dt>
            <dd>{ESTADOS_DE_RESERVA[reserva.estado ?? ""] ?? reserva.estado}</dd>
            {reserva.estado === "pendiente" && reserva.expira_en ? (
              <>
                <dt>Vence</dt>
                <dd>{fechaYHora(reserva.expira_en)}</dd>
              </>
            ) : null}
            <dt>Monto de la reserva</dt>
            <dd>{formatearSoles(reserva.monto)}</dd>
            {reserva.credito_faltante_horas > 0 ? (
              <>
                <dt>Crédito sin tomar</dt>
                <dd>{formatearHoras(reserva.credito_faltante_horas)}: el cliente gastó o perdió ese crédito antes de elegir su nuevo horario (el servicio se confirmó igual).</dd>
              </>
            ) : null}
            {reserva.primera_gratis ? (
              <>
                <dt>Limpieza gratis</dt>
                <dd>Primera limpieza · {formatearHoras(reserva.horas_gratis_aplicadas)} gratis</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p>Este pago no tiene una reserva asociada (el cliente elegirá un nuevo horario cuando se apruebe).</p>
        )}
      </section>

      <section className={estilos.tarjeta}>
        <h2>Comprobante</h2>
        {/* La ruta exige sesión y rol; entrega la imagen en línea con Cache-Control: private, no-store. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={estilos.comprobante} src={comprobante} alt={`Comprobante de pago de ${cliente.nombre}`} />
      </section>

      <section className={estilos.tarjeta}>
        <h2>Direcciones parecidas</h2>
        {!coincidencias.aplica ? (
          <p>Este pago no incluye una limpieza gratis.</p>
        ) : coincidencias.lista.length === 0 ? (
          <p>Sin coincidencias: ninguna otra cuenta recibió la limpieza gratis en una dirección parecida.</p>
        ) : (
          <ul className={estilos.coincidencias}>
            {coincidencias.lista.map((c, i) => (
              <li key={i}>
                <span className={estilos.nivel}>{NIVELES[c.nivel] ?? c.nivel}</span>
                {c.cliente} · {[`${c.calle} ${c.numero}`, c.departamento, c.distrito].filter(Boolean).join(", ")} · {fechaYHora(c.inicio)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {pago.estado === "pendiente" ? (
        <AccionesPago pagoId={pago.id} reservaPendienteId={reserva?.estado === "pendiente" ? reserva.id : null} />
      ) : null}
    </main>
  );
}
