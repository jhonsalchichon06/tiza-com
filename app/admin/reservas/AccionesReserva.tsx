"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { leerError, MENSAJE_SIN_CONEXION } from "@/lib/reservas/asistente/api-cliente";
import estilos from "./reservas.module.css";

export const TEXTO_CONFIRMAR_COMPLETAR = "¿La limpieza ya se realizó? Esto no se puede deshacer desde el portal.";

type Props = {
  reservaId: string;
  puedeCompletar: boolean;
  puedeReasignar: boolean;
  equipoActualId: number;
  equipos: { id: number; nombre: string }[];
};

// Completar (con confirmación previa, porque no hay marcha atrás desde el portal) y reasignar de equipo. El servidor decide
// todo: aquí solo se llama a las rutas, se muestra el mensaje del error tal cual y se refresca la página del servidor.
export function AccionesReserva({ reservaId, puedeCompletar, puedeReasignar, equipoActualId, equipos }: Props) {
  const router = useRouter();
  const otros = equipos.filter((e) => e.id !== equipoActualId);
  const [confirmando, setConfirmando] = useState(false);
  const [destino, setDestino] = useState<number | null>(otros[0]?.id ?? null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(accion: "completar" | "reasignar", cuerpo?: unknown) {
    setOcupado(true);
    setError(null);
    try {
      const respuesta = await fetch(`/api/admin/reservas/${reservaId}/${accion}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo ?? {}),
      });
      if (!respuesta.ok) {
        setError((await leerError(respuesta)).mensaje);
        // Otra persona pudo cambiar la reserva primero: se refresca para mostrar el estado real.
        if (respuesta.status === 409) router.refresh();
        return;
      }
      setConfirmando(false);
      router.refresh();
    } catch {
      setError(MENSAJE_SIN_CONEXION);
    } finally {
      setOcupado(false);
    }
  }

  if (!puedeCompletar && !puedeReasignar) return null;

  return (
    <div className={estilos.acciones}>
      {puedeCompletar && !confirmando ? (
        <button type="button" className={estilos.boton} disabled={ocupado} onClick={() => setConfirmando(true)}>
          Completar
        </button>
      ) : null}
      {puedeCompletar && confirmando ? (
        <div role="alertdialog" aria-label={TEXTO_CONFIRMAR_COMPLETAR} className={estilos.confirmacion}>
          <p>{TEXTO_CONFIRMAR_COMPLETAR}</p>
          <button type="button" className={estilos.boton} disabled={ocupado} onClick={() => enviar("completar")}>
            {ocupado ? "Guardando..." : "Sí, completar"}
          </button>{" "}
          <button type="button" className={`${estilos.boton} ${estilos.botonSecundario}`} disabled={ocupado} onClick={() => setConfirmando(false)}>
            No, volver
          </button>
        </div>
      ) : null}
      {puedeReasignar && otros.length > 0 ? (
        <>
          <label className={estilos.campo}>
            Reasignar a
            <select name="equipo" value={destino ?? ""} onChange={(e) => setDestino(Number(e.target.value))}>
              {otros.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`${estilos.boton} ${estilos.botonSecundario}`}
            disabled={ocupado || destino === null}
            onClick={() => enviar("reasignar", { equipo_id: destino })}
          >
            Reasignar
          </button>
        </>
      ) : null}
      {error ? (
        <p role="alert" className={estilos.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
