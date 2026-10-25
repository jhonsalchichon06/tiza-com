"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Horario } from "@/lib/agenda/disponibilidad";
import { leerError, MENSAJE_SIN_CONEXION } from "@/lib/reservas/asistente/api-cliente";
import { fechaYHora } from "../pagos/formato";
import estilos from "./reservas.module.css";

// Reprogramar una reserva A NOMBRE DEL CLIENTE (design de gestion-de-reservas-y-apoyo, decisión 7). Es la salida cuando no se
// consigue a la persona de apoyo: DECISIÓN DEL USUARIO (2026-10-21), PENDIENTE DE CONFIRMAR POR EL NEGOCIO. El horario se
// acuerda con el cliente por WhatsApp, fuera del sistema; el pago se conserva y el sistema NO avisa al cliente.

export const TEXTO_SIN_AVISO = "El sistema no avisa al cliente: acuerda antes el nuevo horario por WhatsApp.";
export const TEXTO_CONFIRMAR = "¿Ya acordaste este horario con el cliente por WhatsApp? El pago se conserva y el sistema no le avisa.";

export type ResultadoVisible = { inicio: string; vuelveAApoyo: boolean };

type VistaProps = {
  celular: string;
  abierto: boolean;
  fecha: string;
  horarios: Horario[] | null;
  atendido: boolean;
  cargando: boolean;
  elegido: string | null;
  confirmando: boolean;
  enviando: boolean;
  mensaje: string | null;
  resultado: ResultadoVisible | null;
  onAbrir: () => void;
  onCerrar: () => void;
  onFecha: (fecha: string) => void;
  onElegir: (inicio: string) => void;
  onPedirConfirmacion: () => void;
  onVolverDeConfirmar: () => void;
  onConfirmar: () => void;
};

// Presentación pura (se prueba con `renderToStaticMarkup`). Los horarios sin cupo o a menos de la anticipación mínima salen en
// gris y deshabilitados, como en el perfil del cliente.
export function VistaReprogramar(p: VistaProps) {
  if (p.resultado) {
    return (
      <div role="status" className={estilos.acciones}>
        <p className={estilos.exito}>
          Listo. La reserva ahora es el {fechaYHora(p.resultado.inicio)}.
          {p.resultado.vuelveAApoyo ? " Volvió a la lista de apoyo por coordinar." : ""}
        </p>
      </div>
    );
  }
  if (!p.abierto) {
    return (
      <div className={estilos.acciones}>
        <button type="button" className={`${estilos.boton} ${estilos.botonSecundario}`} onClick={p.onAbrir}>
          Reprogramar
        </button>
      </div>
    );
  }
  return (
    <section aria-label="Reprogramar la reserva" className={estilos.confirmacion}>
      <p className={estilos.aviso}>{TEXTO_SIN_AVISO}</p>
      <p className={estilos.detalle}>
        Celular del cliente: <strong>{p.celular}</strong>
      </p>
      {p.mensaje ? (
        <p role="alert" className={estilos.error}>
          {p.mensaje}
        </p>
      ) : null}
      <label className={estilos.campo}>
        Nuevo día
        <input type="date" name="fecha" value={p.fecha} onChange={(e) => p.onFecha(e.target.value)} />
      </label>
      {p.cargando ? <p className={estilos.detalle}>Buscando horarios...</p> : null}
      {p.horarios && !p.atendido ? <p className={estilos.detalle}>Ese día no atendemos. Elige otro día.</p> : null}
      {p.horarios && p.atendido ? (
        <ul className={estilos.horarios} aria-label="Horarios">
          {p.horarios.map((h) => (
            <li key={h.inicio}>
              <button type="button" className={estilos.horario} disabled={!h.disponible} aria-pressed={p.elegido === h.inicio} onClick={() => p.onElegir(h.inicio)}>
                {h.hora}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {p.confirmando && p.elegido ? (
        <div role="alertdialog" aria-label={TEXTO_CONFIRMAR}>
          <p>
            {TEXTO_CONFIRMAR} Nuevo horario: <strong>{fechaYHora(p.elegido)}</strong>.
          </p>
          <div className={estilos.acciones}>
            <button type="button" className={estilos.boton} disabled={p.enviando} onClick={p.onConfirmar}>
              {p.enviando ? "Guardando..." : "Sí, reprogramar"}
            </button>
            <button type="button" className={`${estilos.boton} ${estilos.botonSecundario}`} disabled={p.enviando} onClick={p.onVolverDeConfirmar}>
              No, volver
            </button>
          </div>
        </div>
      ) : (
        <div className={estilos.acciones}>
          <button type="button" className={estilos.boton} disabled={!p.elegido} onClick={p.onPedirConfirmacion}>
            Reprogramar a este horario
          </button>
          <button type="button" className={`${estilos.boton} ${estilos.botonSecundario}`} onClick={p.onCerrar}>
            Cerrar
          </button>
        </div>
      )}
    </section>
  );
}

type Props = { reservaId: string; celular: string; requiereApoyo: boolean };

export function ReprogramarReserva({ reservaId, celular, requiereApoyo }: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState("");
  const [horarios, setHorarios] = useState<Horario[] | null>(null);
  const [atendido, setAtendido] = useState(true);
  const [cargando, setCargando] = useState(false);
  const [elegido, setElegido] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoVisible | null>(null);

  async function cargarHorarios(dia: string) {
    setFecha(dia);
    setElegido(null);
    setConfirmando(false);
    setHorarios(null);
    setMensaje(null);
    if (!dia) return;
    setCargando(true);
    try {
      const respuesta = await fetch(`/api/admin/reservas/${reservaId}/disponibilidad?fecha=${encodeURIComponent(dia)}`, { headers: { Accept: "application/json" } });
      if (!respuesta.ok) {
        setMensaje((await leerError(respuesta)).mensaje);
        return;
      }
      const cuerpo = (await respuesta.json()) as { atendido: boolean; horarios: Horario[] };
      setAtendido(cuerpo.atendido);
      setHorarios(cuerpo.horarios);
    } catch {
      setMensaje(MENSAJE_SIN_CONEXION);
    } finally {
      setCargando(false);
    }
  }

  async function reprogramar() {
    if (!elegido) return;
    setEnviando(true);
    setMensaje(null);
    try {
      const respuesta = await fetch(`/api/admin/reservas/${reservaId}/reprogramar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inicio: elegido }),
      });
      if (!respuesta.ok) {
        const error = await leerError(respuesta);
        setConfirmando(false);
        setMensaje(error.mensaje);
        // Sin cupo: otro cliente tomó el hueco; se vuelve a pedir la lista para elegir otra hora.
        if (respuesta.status === 409) {
          await cargarHorarios(fecha);
          setMensaje(error.mensaje);
        }
        return;
      }
      const cuerpo = (await respuesta.json()) as { reserva: { inicio: string } };
      setResultado({ inicio: cuerpo.reserva.inicio, vuelveAApoyo: requiereApoyo });
      router.refresh();
    } catch {
      setMensaje(MENSAJE_SIN_CONEXION);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <VistaReprogramar
      celular={celular}
      abierto={abierto}
      fecha={fecha}
      horarios={horarios}
      atendido={atendido}
      cargando={cargando}
      elegido={elegido}
      confirmando={confirmando}
      enviando={enviando}
      mensaje={mensaje}
      resultado={resultado}
      onAbrir={() => setAbierto(true)}
      onCerrar={() => {
        setAbierto(false);
        setMensaje(null);
      }}
      onFecha={cargarHorarios}
      onElegir={setElegido}
      onPedirConfirmacion={() => setConfirmando(true)}
      onVolverDeConfirmar={() => setConfirmando(false)}
      onConfirmar={reprogramar}
    />
  );
}
