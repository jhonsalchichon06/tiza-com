"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { leerError, MENSAJE_SIN_CONEXION } from "@/lib/reservas/asistente/api-cliente";
import estilos from "./resenas.module.css";

// Aprobar y Rechazar una reseña pendiente. Rechazar pide confirmación en dos pasos (el cliente podrá editarla y reenviarla).
// Muestra el mensaje del servidor tal cual y refresca la página del servidor; ante un 409 también (la reseña ya cambió).
export function AccionesResena({ id, revision }: { id: string; revision: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decidir(accion: "aprobar" | "rechazar") {
    setOcupado(true);
    setError(null);
    try {
      const respuesta = await fetch(`/api/admin/resenas/${id}/${accion}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision }) });
      if (!respuesta.ok) {
        setError((await leerError(respuesta)).mensaje);
        setConfirmando(false);
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
    <div className={estilos.acciones}>
      {confirmando ? (
        <>
          <span className={estilos.pregunta}>¿Rechazar esta reseña? El cliente podrá editarla y reenviarla.</span>
          <button type="button" className={`${estilos.boton} ${estilos.botonPeligro}`} disabled={ocupado} onClick={() => decidir("rechazar")}>
            {ocupado ? "Rechazando..." : "Sí, rechazar"}
          </button>
          <button type="button" className={`${estilos.boton} ${estilos.botonSecundario}`} disabled={ocupado} onClick={() => setConfirmando(false)}>
            No, volver
          </button>
        </>
      ) : (
        <>
          <button type="button" className={estilos.boton} disabled={ocupado} onClick={() => decidir("aprobar")}>
            {ocupado ? "Aprobando..." : "Aprobar"}
          </button>
          <button type="button" className={`${estilos.boton} ${estilos.botonSecundario}`} disabled={ocupado} onClick={() => setConfirmando(true)}>
            Rechazar
          </button>
        </>
      )}
      {error ? (
        <p role="alert" className={estilos.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
