"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { leerError, MENSAJE_SIN_CONEXION } from "@/lib/reservas/asistente/api-cliente";
import estilos from "../reservas/reservas.module.css";

// Máximo de la nota; el servidor lo valida también (500).
const LARGO_MAXIMO = 500;

// Marcar el apoyo como coordinado con una nota (nombre y teléfono de la persona, por ejemplo). Llama a la ruta, muestra el
// mensaje del error tal cual y refresca la página del servidor.
export function AccionApoyo({ reservaId, notaInicial }: { reservaId: string; notaInicial: string | null }) {
  const router = useRouter();
  const [nota, setNota] = useState(notaInicial ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function marcar() {
    setOcupado(true);
    setError(null);
    try {
      const respuesta = await fetch(`/api/admin/reservas/${reservaId}/apoyo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nota }),
      });
      if (!respuesta.ok) {
        setError((await leerError(respuesta)).mensaje);
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
      <label className={estilos.campo}>
        Nota (opcional): nombre y teléfono de la persona de apoyo
        <textarea name="nota" rows={2} maxLength={LARGO_MAXIMO} value={nota} onChange={(e) => setNota(e.target.value)} />
      </label>
      <button type="button" className={estilos.boton} disabled={ocupado} onClick={marcar}>
        {ocupado ? "Guardando..." : "Marcar coordinado"}
      </button>
      {error ? (
        <p role="alert" className={estilos.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
