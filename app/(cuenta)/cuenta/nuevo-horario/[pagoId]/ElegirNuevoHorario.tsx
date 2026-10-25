"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { diasReservables } from "@/lib/reservas/asistente/dias";
import type { HorarioElegido } from "@/lib/reservas/asistente/estado";
import {
  confirmarNuevoHorario,
  pedirDisponibilidadNuevoHorario,
  type CandadoNuevoHorario,
} from "@/lib/reservas/asistente/nuevo-horario-cliente";
import type { RespuestaNuevoHorario } from "@/lib/reservas/nuevo-horario";
import type { DatosNuevoHorario } from "@/lib/reservas/nuevo-horario-datos";
import type { DisponibilidadDelDia } from "../../../../reservar/PasoFecha";
import { VistaNuevoHorario } from "./VistaNuevoHorario";

// Contenedor con estado de la pantalla del nuevo horario. Reutiliza `PasoFecha` y `diasReservables`; los horarios en gris
// (sin cupo, a menos de la anticipación mínima o posteriores al fin de la membresía) los marcan el servidor y el límite.
export function ElegirNuevoHorario({ pagoId, datos }: { pagoId: string; datos: DatosNuevoHorario }) {
  const [dia, setDia] = useState<string | null>(null);
  const [horario, setHorario] = useState<HorarioElegido | null>(null);
  const [disponibilidad, setDisponibilidad] = useState<DisponibilidadDelDia>({ estado: "sin_elegir" });
  const [reintento, setReintento] = useState(0);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enCredito, setEnCredito] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<RespuestaNuevoHorario | null>(null);
  const candado = useRef<CandadoNuevoHorario>({ enCurso: null });

  const dias = useMemo(() => diasReservables(datos.fechas.desde, datos.fechas.hasta), [datos.fechas.desde, datos.fechas.hasta]);

  useEffect(() => {
    if (!dia) {
      setDisponibilidad({ estado: "sin_elegir" });
      return;
    }
    let activo = true;
    setDisponibilidad({ estado: "cargando" });
    pedirDisponibilidadNuevoHorario(pagoId, dia, (url, init) => fetch(url, init))
      .then((r) => {
        if (activo) setDisponibilidad({ estado: "listo", atendido: r.atendido, horarios: r.horarios });
      })
      .catch((error: Error) => {
        if (activo) setDisponibilidad({ estado: "error", mensaje: error.message });
      });
    return () => {
      activo = false;
    };
  }, [pagoId, dia, reintento]);

  async function alConfirmar() {
    if (!horario) return;
    setEnviando(true);
    const r = await confirmarNuevoHorario({ pagoId, inicio: horario.inicio }, { pedir: (url, init) => fetch(url, init), candado: candado.current });
    setEnviando(false);
    if (r.tipo === "ok") {
      setResultado(r.respuesta);
    } else if (r.tipo === "sin_cupo") {
      // Otro cliente tomó el cupo: vuelve a la lista de horarios con el mensaje y el pago intacto.
      setHorario(null);
      setMensaje(r.mensaje);
      setReintento((n) => n + 1);
    } else if (r.tipo === "en_credito") {
      setEnCredito(true);
      setMensaje(r.mensaje);
    } else {
      setMensaje(r.mensaje);
    }
  }

  return (
    <VistaNuevoHorario
      datos={datos}
      dias={dias}
      dia={dia}
      horario={horario}
      disponibilidad={disponibilidad}
      mensaje={mensaje}
      enviando={enviando}
      enCredito={enCredito}
      resultado={resultado}
      onDia={(nuevo) => {
        setDia(nuevo);
        setHorario(null);
        setMensaje(null);
      }}
      onHorario={(elegido) => {
        setHorario(elegido);
        setMensaje(null);
      }}
      onReintentarHorarios={() => setReintento((n) => n + 1)}
      onConfirmar={alConfirmar}
    />
  );
}
