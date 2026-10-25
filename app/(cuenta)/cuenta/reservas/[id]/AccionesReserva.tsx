"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Horario } from "@/lib/agenda/disponibilidad";
import {
  cancelarDesdeElPerfil,
  pedirHorariosDeReserva,
  reprogramarDesdeElPerfil,
  type Candado,
  type ResultadoDeCancelar,
  type ResultadoDeReprogramar,
} from "@/lib/perfil/acciones-cliente";
import { formatearFechaHora } from "@/lib/perfil/textos";
import estilos from "../../cuenta.module.css";

// Cancelar (en dos pasos) y cambiar día y hora desde el detalle de una reserva. El servidor valida todo: plazo, horario y
// cupo. Los horarios sin cupo o a menos de la anticipación mínima salen en gris y deshabilitados.

export type ModoDeAcciones = "inicio" | "confirmar_cancelacion" | "cambiar";
export type ResultadoVisible =
  | { tipo: "cancelada"; limpiezaGratisConservada: boolean; mensajeCredito: string | null }
  | { tipo: "reprogramada"; inicio: string; pendiente: boolean };

export const TEXTO_CONFIRMAR_CANCELACION = "¿Seguro que quieres cancelar?";
export const TEXTO_AVISO_APOYO = "Esta limpieza lleva una persona de apoyo: nuestro equipo volverá a coordinarla para la fecha nueva.";

type VistaProps = {
  puedeCancelar: boolean;
  puedeReprogramar: boolean;
  requiereApoyo: boolean;
  zona: string;
  modo: ModoDeAcciones;
  enviando: boolean;
  mensaje: string | null;
  whatsapp: string | null;
  resultado: ResultadoVisible | null;
  fecha: string;
  horarios: Horario[] | null;
  cargandoHorarios: boolean;
  atendido: boolean;
  elegido: string | null;
  onModo: (modo: ModoDeAcciones) => void;
  onCancelar: () => void;
  onFecha: (fecha: string) => void;
  onElegir: (inicio: string) => void;
  onConfirmarCambio: () => void;
};

export function VistaAcciones(p: VistaProps) {
  if (p.resultado?.tipo === "cancelada") {
    return (
      <div role="status">
        <p className={estilos.exito}>Tu reserva fue cancelada.</p>
        {p.resultado.limpiezaGratisConservada ? (
          <p className={estilos.dato}>Tu limpieza gratis no se pierde: la podrás usar en tu próxima reserva.</p>
        ) : null}
        {p.resultado.mensajeCredito ? <p className={estilos.dato}>{p.resultado.mensajeCredito}</p> : null}
      </div>
    );
  }
  if (p.resultado?.tipo === "reprogramada") {
    return (
      <div role="status">
        <p className={estilos.exito}>Listo. Tu limpieza ahora es el {formatearFechaHora(p.resultado.inicio, p.zona)}.</p>
        {p.resultado.pendiente ? <p className={estilos.dato}>Sigue esperando la aprobación de tu pago.</p> : null}
      </div>
    );
  }

  return (
    <section aria-label="Acciones de la reserva">
      {p.mensaje ? (
        <p role="alert" className={estilos.error}>
          {p.mensaje}
          {p.whatsapp ? (
            <>
              {" "}
              <a className={estilos.enlace} href={p.whatsapp} target="_blank" rel="noreferrer">
                Escríbenos por WhatsApp
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      {p.modo === "inicio" ? (
        <div className={estilos.acciones}>
          {p.puedeReprogramar ? (
            <button type="button" className={estilos.boton} onClick={() => p.onModo("cambiar")}>
              Cambiar día y hora
            </button>
          ) : null}
          {p.puedeCancelar ? (
            <button type="button" className={`${estilos.boton} ${estilos.botonSecundario}`} onClick={() => p.onModo("confirmar_cancelacion")}>
              Cancelar reserva
            </button>
          ) : null}
        </div>
      ) : null}

      {p.modo === "confirmar_cancelacion" ? (
        <div role="alertdialog" aria-label={TEXTO_CONFIRMAR_CANCELACION}>
          <p className={estilos.tarjetaTitulo}>{TEXTO_CONFIRMAR_CANCELACION}</p>
          <div className={estilos.acciones}>
            <button type="button" className={`${estilos.boton} ${estilos.botonPeligro}`} disabled={p.enviando} onClick={p.onCancelar}>
              {p.enviando ? "Cancelando..." : "Sí, cancelar"}
            </button>
            <button type="button" className={`${estilos.boton} ${estilos.botonSecundario}`} disabled={p.enviando} onClick={() => p.onModo("inicio")}>
              No, volver
            </button>
          </div>
        </div>
      ) : null}

      {p.modo === "cambiar" ? (
        <div>
          {p.requiereApoyo ? <p className={estilos.dato}>{TEXTO_AVISO_APOYO}</p> : null}
          <label className={estilos.campo}>
            Elige el nuevo día
            <input type="date" name="fecha" value={p.fecha} onChange={(e) => p.onFecha(e.target.value)} />
          </label>
          {p.cargandoHorarios ? <p className={estilos.mutado}>Buscando horarios...</p> : null}
          {p.horarios && !p.atendido ? <p className={estilos.dato}>Ese día no atendemos. Elige otro día.</p> : null}
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
          <div className={estilos.acciones}>
            <button type="button" className={estilos.boton} disabled={!p.elegido || p.enviando} onClick={p.onConfirmarCambio}>
              {p.enviando ? "Guardando..." : "Confirmar el cambio"}
            </button>
            <button type="button" className={`${estilos.boton} ${estilos.botonSecundario}`} disabled={p.enviando} onClick={() => p.onModo("inicio")}>
              Volver
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

type Props = { reservaId: string; puedeCancelar: boolean; puedeReprogramar: boolean; requiereApoyo: boolean; zona: string };

export function AccionesReserva({ reservaId, puedeCancelar, puedeReprogramar, requiereApoyo, zona }: Props) {
  const router = useRouter();
  const candadoCancelar = useRef<Candado<ResultadoDeCancelar>>({ enCurso: null });
  const candadoCambio = useRef<Candado<ResultadoDeReprogramar>>({ enCurso: null });
  const [modo, setModo] = useState<ModoDeAcciones>("inicio");
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoVisible | null>(null);
  const [fecha, setFecha] = useState("");
  const [horarios, setHorarios] = useState<Horario[] | null>(null);
  const [atendido, setAtendido] = useState(true);
  const [cargandoHorarios, setCargandoHorarios] = useState(false);
  const [elegido, setElegido] = useState<string | null>(null);
  const pedir = (url: string, init?: RequestInit) => fetch(url, init);

  function cambiarModo(nuevo: ModoDeAcciones) {
    setMensaje(null);
    setWhatsapp(null);
    setModo(nuevo);
  }

  async function cancelar() {
    setMensaje(null);
    setEnviando(true);
    const r = await cancelarDesdeElPerfil(reservaId, { pedir, candado: candadoCancelar.current, zona });
    setEnviando(false);
    if (r.tipo === "ok") {
      setResultado({ tipo: "cancelada", limpiezaGratisConservada: r.limpiezaGratisConservada, mensajeCredito: r.mensajeCredito });
      router.refresh();
      return;
    }
    setModo("inicio");
    setMensaje(r.mensaje);
    setWhatsapp(r.tipo === "fuera_de_plazo" ? r.whatsapp : null);
  }

  async function cargarHorarios(dia: string) {
    setFecha(dia);
    setElegido(null);
    setHorarios(null);
    setMensaje(null);
    if (!dia) return;
    setCargandoHorarios(true);
    const r = await pedirHorariosDeReserva(reservaId, dia, pedir);
    setCargandoHorarios(false);
    if (r.tipo === "ok") {
      setHorarios(r.disponibilidad.horarios);
      setAtendido(r.disponibilidad.atendido);
    } else {
      setMensaje(r.mensaje);
    }
  }

  async function confirmarCambio() {
    if (!elegido) return;
    setMensaje(null);
    setEnviando(true);
    const r = await reprogramarDesdeElPerfil(reservaId, elegido, { pedir, candado: candadoCambio.current });
    setEnviando(false);
    if (r.tipo === "ok") {
      setResultado({ tipo: "reprogramada", inicio: r.inicio, pendiente: r.pendiente });
      router.refresh();
      return;
    }
    setMensaje(r.mensaje);
    if (r.tipo === "fuera_de_plazo") {
      setWhatsapp(r.whatsapp);
      setModo("inicio");
    } else if (r.tipo === "sin_cupo") {
      // Otro cliente tomó el cupo: se vuelve a pedir la lista y a elegir otra hora.
      await cargarHorarios(fecha);
      setMensaje(r.mensaje);
    }
  }

  return (
    <VistaAcciones
      puedeCancelar={puedeCancelar}
      puedeReprogramar={puedeReprogramar}
      requiereApoyo={requiereApoyo}
      zona={zona}
      modo={modo}
      enviando={enviando}
      mensaje={mensaje}
      whatsapp={whatsapp}
      resultado={resultado}
      fecha={fecha}
      horarios={horarios}
      cargandoHorarios={cargandoHorarios}
      atendido={atendido}
      elegido={elegido}
      onModo={cambiarModo}
      onCancelar={cancelar}
      onFecha={cargarHorarios}
      onElegir={setElegido}
      onConfirmarCambio={confirmarCambio}
    />
  );
}
