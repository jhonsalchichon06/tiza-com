"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { leerError, MENSAJE_SIN_CONEXION } from "@/lib/reservas/asistente/api-cliente";
import estilos from "../pagos.module.css";

type Props = {
  pagoId: string;
  // La reserva `pendiente` del pago, si la hay: solo esa se puede cancelar como comprobante falso.
  reservaPendienteId: string | null;
};

// Aprobar, rechazar (con motivo opcional) y cancelar la reserva. Llama a las rutas /api/admin y muestra el mensaje del
// error tal cual; al terminar refresca la página del servidor.
export function AccionesPago({ pagoId, reservaPendienteId }: Props) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(ruta: string, cuerpo?: unknown) {
    setOcupado(true);
    setError(null);
    try {
      const respuesta = await fetch(ruta, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo ?? {}),
      });
      if (!respuesta.ok) {
        setError((await leerError(respuesta)).mensaje);
        // Otro administrador pudo revisar el pago primero: se refresca para mostrar el estado real.
        if (respuesta.status === 409) router.refresh();
        return;
      }
      router.refresh();
    } catch {
      setError(MENSAJE_SIN_CONEXION);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className={estilos.tarjeta}>
      <h2>Decisión</h2>
      <div className={estilos.acciones}>
        <button type="button" className={estilos.boton} disabled={ocupado} onClick={() => enviar(`/api/admin/pagos/${pagoId}/aprobar`)}>
          Aprobar
        </button>
        <div>
          <label htmlFor="motivo-rechazo">Motivo del rechazo (opcional)</label>
          <textarea
            id="motivo-rechazo"
            className={estilos.motivo}
            maxLength={200}
            rows={2}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <button
            type="button"
            className={`${estilos.boton} ${estilos.botonPeligro}`}
            disabled={ocupado}
            onClick={() => enviar(`/api/admin/pagos/${pagoId}/rechazar`, { motivo })}
          >
            Rechazar
          </button>
        </div>
        {reservaPendienteId ? (
          <button
            type="button"
            className={`${estilos.boton} ${estilos.botonSecundario}`}
            disabled={ocupado}
            onClick={() => enviar(`/api/admin/reservas/${reservaPendienteId}/cancelar`)}
          >
            Cancelar reserva
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className={estilos.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
