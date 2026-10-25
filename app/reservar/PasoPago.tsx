import Link from "next/link";
import type { ChangeEvent } from "react";
import type { Metodo } from "@/lib/reservas/asistente/estado";
import { CCI_TIZA, RUTA_QR_YAPE, TITULAR_TIZA } from "@/lib/reservas/datos-de-pago";
import type { Cotizacion } from "@/lib/reservas/cotizar";
import { formatearHoras, formatearSoles } from "@/lib/soles";
import { AvisoDemostracion } from "./AvisoDemostracion";
import { AvisoDeCredito, AvisoSinGratis } from "./ResumenCotizacion";
import estilos from "./reservar.module.css";

type Props = {
  cotizacion: Cotizacion;
  metodo: Metodo | null;
  comprobante: string | null; // ruta ya subida
  subiendo: boolean;
  errorDeArchivo: string | null;
  mensaje: string | null; // error del servidor al confirmar
  bloqueado: boolean; // ya hay una reserva o un pago en revisión: sin reintento
  // Con un pago aprobado esperando horario: a dónde ir a elegirlo (el perfil lo avisa).
  enlaceBloqueo?: string | null;
  enviando: boolean;
  onMetodo: (metodo: Metodo) => void;
  onArchivo: (archivo: File) => void;
  onConfirmar: () => void;
  onRevisarDatos: () => void;
};

export function PasoPago({
  cotizacion,
  metodo,
  comprobante,
  subiendo,
  errorDeArchivo,
  mensaje,
  bloqueado,
  enlaceBloqueo = null,
  enviando,
  onMetodo,
  onArchivo,
  onConfirmar,
  onRevisarDatos,
}: Props) {
  const { membresia } = cotizacion;
  // Sin nada que pagar (lo decide el servidor) no se pide método ni comprobante.
  const sinCosto = cotizacion.total_a_pagar === 0;
  const puedeConfirmar = (sinCosto || (metodo !== null && comprobante !== null)) && !subiendo && !enviando && !bloqueado;

  const alElegirArchivo = (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    if (archivo) onArchivo(archivo);
  };

  return (
    <div>
      <AvisoDeCredito cotizacion={cotizacion} />
      <dl className={estilos.resumen} aria-label="Resumen de tu pago">
        {membresia ? (
          <div className={estilos.resumenFila}>
            <dt>
              Tiza Club ({formatearSoles(membresia.mensual)} al mes por {membresia.meses} meses)
            </dt>
            <dd>{formatearSoles(membresia.total)}</dd>
          </div>
        ) : null}
        {cotizacion.monto > 0 ? (
          <div className={estilos.resumenFila}>
            <dt>{cotizacion.aplica_gratis ? "Horas adicionales" : "Horas a pagar"} ({formatearHoras(cotizacion.horas_cobrar)})</dt>
            <dd>{formatearSoles(cotizacion.monto)}</dd>
          </div>
        ) : null}
        {sinCosto ? (
          <div className={`${estilos.resumenFila} ${estilos.resumenTotal}`}>
            <dt>Esta limpieza no tiene costo</dt>
            <dd>{formatearSoles(0)}</dd>
          </div>
        ) : (
          <div className={`${estilos.resumenFila} ${estilos.resumenTotal}`}>
            <dt>Total a pagar</dt>
            <dd>{formatearSoles(cotizacion.total_a_pagar)}</dd>
          </div>
        )}
      </dl>
      <AvisoSinGratis cotizacion={cotizacion} />
      {sinCosto ? (
        <p className={estilos.ayuda}>No tienes que pagar ni subir ningún comprobante: tu limpieza queda confirmada al enviar tu reserva.</p>
      ) : cotizacion.modo === "miembro" ? (
        <p className={estilos.ayuda}>
          Tu reserva queda en espera hasta que revisemos tu pago (máximo {formatearHoras(cotizacion.espera_pago_horas)}). Cuando lo aprobemos, tu
          limpieza queda confirmada.
        </p>
      ) : (
        <p className={estilos.ayuda}>
          La membresía se paga en un solo pago por adelantado y no se reembolsa. Tu primera limpieza queda en espera hasta que revisemos tu
          pago (máximo {formatearHoras(cotizacion.espera_pago_horas)}).
        </p>
      )}

      {sinCosto ? null : (
        <>
          <fieldset className={estilos.grupo}>
            <legend className={estilos.grupoTitulo}>¿Cómo vas a pagar?</legend>
            <div className={estilos.opciones}>
              <label className={estilos.opcion}>
                <input type="radio" name="metodo" value="yape" checked={metodo === "yape"} onChange={() => onMetodo("yape")} />
                <span className={estilos.opcionNombre}>Yape</span>
                <span className={estilos.opcionDetalle}>Escanea el código QR</span>
              </label>
              <label className={estilos.opcion}>
                <input
                  type="radio"
                  name="metodo"
                  value="transferencia"
                  checked={metodo === "transferencia"}
                  onChange={() => onMetodo("transferencia")}
                />
                <span className={estilos.opcionNombre}>Transferencia</span>
                <span className={estilos.opcionDetalle}>Usa nuestra cuenta interbancaria (CCI)</span>
              </label>
            </div>
          </fieldset>

          <div className={estilos.datosPago}>
            <AvisoDemostracion />
            {metodo === "yape" ? (
              <>
                <img
                  className={estilos.qr}
                  src={RUTA_QR_YAPE}
                  alt={`Código QR de Yape de Tiza, a nombre de ${TITULAR_TIZA}`}
                  width={480}
                  height={480}
                />
                <p className={estilos.titular}>Yape a nombre de {TITULAR_TIZA}</p>
              </>
            ) : metodo === "transferencia" ? (
              <>
                <p className={estilos.titular}>Código de cuenta interbancario (CCI)</p>
                <p className={estilos.cci}>{CCI_TIZA}</p>
                <p className={estilos.titular}>Titular: {TITULAR_TIZA}</p>
              </>
            ) : (
              <p className={estilos.titular}>Elige Yape o transferencia para ver los datos de pago.</p>
            )}
          </div>

          <label className={estilos.archivo}>
            Sube la foto o la captura de tu comprobante
            <input
              name="comprobante"
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              onChange={alElegirArchivo}
              disabled={subiendo || enviando}
            />
          </label>
          <p className={estilos.ayuda}>Imagen JPG, PNG o WebP, de hasta 5 MB.</p>
          {subiendo ? (
            <p className={estilos.ayuda} aria-live="polite">
              Subiendo tu comprobante...
            </p>
          ) : comprobante ? (
            <p className={estilos.exito}>Comprobante subido.</p>
          ) : null}
          {errorDeArchivo ? (
            <p role="alert" className={estilos.error}>
              {errorDeArchivo}
            </p>
          ) : null}
        </>
      )}

      {mensaje ? (
        <p role="alert" className={estilos.error}>
          {mensaje}
        </p>
      ) : null}
      {bloqueado && enlaceBloqueo ? (
        <p className={estilos.ayuda}>
          <Link href={enlaceBloqueo}>Ir a mi cuenta para elegir mi nuevo día y hora</Link>
        </p>
      ) : null}

      <div className={estilos.acciones}>
        <button type="button" className={estilos.boton} disabled={!puedeConfirmar} onClick={onConfirmar}>
          {enviando ? "Enviando..." : "Confirmar mi reserva"}
        </button>
        {mensaje && !bloqueado ? (
          <button type="button" className={`${estilos.boton} ${estilos.botonSecundario}`} onClick={onRevisarDatos}>
            Revisar mis datos
          </button>
        ) : null}
      </div>
    </div>
  );
}
