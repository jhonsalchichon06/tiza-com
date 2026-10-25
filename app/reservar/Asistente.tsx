"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { pedirCotizacion, pedirDisponibilidad } from "@/lib/reservas/asistente/api-cliente";
import { subirComprobante } from "@/lib/reservas/asistente/comprobante";
import { confirmarReserva, type Candado } from "@/lib/reservas/asistente/confirmar";
import { diasReservables } from "@/lib/reservas/asistente/dias";
import { claveDeDireccion, estadoInicial, puedeAvanzar, reductor, servicioDeEstado, sinCosto, type Estado, type Paso } from "@/lib/reservas/asistente/estado";
import type { ParametrosIniciales } from "@/lib/reservas/asistente/parametros";
import { PasoDireccion } from "./PasoDireccion";
import { PasoFecha, TEXTO_LIMITE_MIEMBRO, TEXTO_LIMITE_PRIMERA, type DisponibilidadDelDia } from "./PasoFecha";
import { PasoListo } from "./PasoListo";
import { PasoPago } from "./PasoPago";
import { PasoServicio } from "./PasoServicio";
import { PasoTamano, type PaqueteDeHoras } from "./PasoTamano";
import estilos from "./reservar.module.css";

type Props = { usuarioId: string; inicial: ParametrosIniciales; paquetes: PaqueteDeHoras[] };

const PASOS_VISIBLES = 5;

function tituloDelPaso(paso: Paso, esPaquete: boolean, estado: Pick<Estado, "cotizacion" | "reserva">): string {
  const esMiembro = estado.cotizacion?.modo === "miembro";
  switch (paso) {
    case 1:
      return "Elige tu servicio";
    case 2:
      return esPaquete ? "Elige tus horas" : "Cuéntanos de tu hogar";
    case 3:
      return "Elige el día y la hora";
    case 4:
      return "¿Dónde haremos la limpieza?";
    case 5:
      if (!esMiembro) return "Paga tu membresía y confirma";
      return sinCosto(estado) ? "Confirma tu reserva" : "Paga tu limpieza y confirma";
    case 6:
      return estado.reserva?.reserva.estado === "confirmada" ? "¡Tu limpieza está confirmada!" : "¡Tu reserva está en espera!";
  }
}

export function Asistente({ usuarioId, inicial, paquetes }: Props) {
  const [estado, despachar] = useReducer(reductor, inicial, estadoInicial);
  const [cotizando, setCotizando] = useState(false);
  const [errorDeCotizacion, setErrorDeCotizacion] = useState<string | null>(null);
  const [reintentoCotizacion, setReintentoCotizacion] = useState(0);
  const [cotizandoPago, setCotizandoPago] = useState(false);
  const [errorDePago, setErrorDePago] = useState<string | null>(null);
  const [reintentoPago, setReintentoPago] = useState(0);
  const [disponibilidad, setDisponibilidad] = useState<DisponibilidadDelDia>({ estado: "sin_elegir" });
  const [reintentoDisponibilidad, setReintentoDisponibilidad] = useState(0);
  const [subiendo, setSubiendo] = useState(false);
  const [errorDeArchivo, setErrorDeArchivo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const candado = useRef<Candado>({ enCurso: null });
  const titulo = useRef<HTMLHeadingElement>(null);
  const primeraVez = useRef(true);

  const servicio = servicioDeEstado(estado);
  const claveServicio = JSON.stringify(servicio);
  const hayCotizacion = estado.cotizacion !== null;
  const claveDireccion = claveDeDireccion(estado.direccion);
  const cotizadaConEstaDireccion = estado.direccionCotizada === claveDireccion;

  // Cotización del servidor: se pide al llegar al paso 2 y cada vez que cambia el servicio.
  useEffect(() => {
    if (estado.paso !== 2 || claveServicio === "null" || hayCotizacion) return;
    let activo = true;
    setCotizando(true);
    setErrorDeCotizacion(null);
    pedirCotizacion(JSON.parse(claveServicio), (url, init) => fetch(url, init))
      .then((cotizacion) => {
        if (activo) despachar({ tipo: "cotizacion_lista", cotizacion });
      })
      .catch((error: Error) => {
        if (activo) setErrorDeCotizacion(error.message);
      })
      .finally(() => {
        if (activo) setCotizando(false);
      });
    return () => {
      activo = false;
    };
  }, [estado.paso, claveServicio, hayCotizacion, reintentoCotizacion]);

  // Al llegar al paso de pago se vuelve a cotizar con la dirección: el servidor dice si ese hogar ya recibió la
  // limpieza gratis y, si es así, el precio es el completo. El navegador no decide nada.
  useEffect(() => {
    if (estado.paso !== 5 || claveServicio === "null" || !hayCotizacion || cotizadaConEstaDireccion) return;
    let activo = true;
    setCotizandoPago(true);
    setErrorDePago(null);
    pedirCotizacion(JSON.parse(claveServicio), (url, init) => fetch(url, init), estado.direccion)
      .then((cotizacion) => {
        if (activo) despachar({ tipo: "cotizacion_con_direccion", cotizacion, clave: claveDireccion });
      })
      .catch((error: Error) => {
        if (activo) setErrorDePago(error.message);
      })
      .finally(() => {
        if (activo) setCotizandoPago(false);
      });
    return () => {
      activo = false;
    };
    // La dirección entra por su clave: las referencias no cambian el precio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado.paso, claveServicio, hayCotizacion, cotizadaConEstaDireccion, claveDireccion, reintentoPago]);

  // Horarios del día elegido.
  useEffect(() => {
    if (estado.paso !== 3 || !estado.dia || claveServicio === "null") {
      setDisponibilidad({ estado: "sin_elegir" });
      return;
    }
    let activo = true;
    setDisponibilidad({ estado: "cargando" });
    pedirDisponibilidad(JSON.parse(claveServicio), estado.dia, (url, init) => fetch(url, init))
      .then((r) => {
        if (activo) setDisponibilidad({ estado: "listo", atendido: r.atendido, horarios: r.horarios });
      })
      .catch((error: Error) => {
        if (activo) setDisponibilidad({ estado: "error", mensaje: error.message });
      });
    return () => {
      activo = false;
    };
  }, [estado.paso, estado.dia, claveServicio, reintentoDisponibilidad]);

  // Al cambiar de paso, el foco y la vista van al título (lectores de pantalla y teclado).
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    titulo.current?.focus();
    window.scrollTo({ top: 0 });
  }, [estado.paso]);

  const dias = useMemo(
    () => (estado.cotizacion ? diasReservables(estado.cotizacion.fechas.desde, estado.cotizacion.fechas.hasta) : []),
    [estado.cotizacion],
  );

  async function alElegirArchivo(archivo: File) {
    setSubiendo(true);
    setErrorDeArchivo(null);
    despachar({ tipo: "comprobante_subido", ruta: null });
    const resultado = await subirComprobante(archivo, usuarioId);
    setSubiendo(false);
    if (resultado.ok) despachar({ tipo: "comprobante_subido", ruta: resultado.ruta });
    else setErrorDeArchivo(resultado.mensaje);
  }

  async function alConfirmar() {
    setEnviando(true);
    const resultado = await confirmarReserva(
      { estado },
      { subir: () => Promise.reject(new Error("El comprobante se sube al elegir el archivo.")), pedir: (url, init) => fetch(url, init), candado: candado.current },
    );
    setEnviando(false);
    if (resultado.tipo === "ok") despachar({ tipo: "reserva_creada", respuesta: resultado.respuesta });
    else if (resultado.tipo === "sin_cupo") despachar({ tipo: "sin_cupo", mensaje: resultado.mensaje, comprobante: resultado.comprobante });
    else if (resultado.tipo === "bloqueado") despachar({ tipo: "bloqueado", mensaje: resultado.mensaje, enlace: resultado.enlace });
    else if (resultado.tipo === "recotizar") despachar({ tipo: "recotizar", mensaje: resultado.mensaje });
    else if (resultado.tipo === "gratis_usada") despachar({ tipo: "gratis_usada", mensaje: resultado.mensaje });
    else despachar({ tipo: "error_de_envio", mensaje: resultado.mensaje });
  }

  const paso = estado.paso;
  const esPaquete = estado.tipo === "paquete";

  return (
    <div>
      {paso < 6 ? (
        <div className={estilos.progreso}>
          <p className={estilos.progresoTexto}>
            Paso {paso} de {PASOS_VISIBLES}
          </p>
          <div className={estilos.progresoRiel} role="presentation">
            <span className={estilos.progresoRelleno} style={{ width: `${(paso / PASOS_VISIBLES) * 100}%` }} />
          </div>
        </div>
      ) : null}

      <h1 className={estilos.titulo} ref={titulo} tabIndex={-1}>
        {tituloDelPaso(paso, esPaquete, estado)}
      </h1>

      {paso === 1 ? <PasoServicio tipo={estado.tipo} onElegir={(servicio) => despachar({ tipo: "elegir_servicio", servicio })} /> : null}

      {paso === 2 && estado.tipo ? (
        <PasoTamano
          tipo={estado.tipo}
          dormitorios={estado.dormitorios}
          banos={estado.banos}
          horasPaquete={estado.horasPaquete}
          paquetes={paquetes}
          cotizacion={estado.cotizacion}
          cargando={cotizando && !hayCotizacion}
          errorDeCotizacion={errorDeCotizacion}
          onDormitorios={(valor) => despachar({ tipo: "fijar_dormitorios", valor })}
          onBanos={(valor) => despachar({ tipo: "fijar_banos", valor })}
          onPaquete={(horas) => despachar({ tipo: "elegir_paquete", horas })}
          onReintentar={() => setReintentoCotizacion((n) => n + 1)}
        />
      ) : null}

      {paso === 3 && estado.cotizacion ? (
        <PasoFecha
          dias={dias}
          limite={estado.cotizacion.limite}
          textoLimite={estado.cotizacion.modo === "miembro" ? TEXTO_LIMITE_MIEMBRO : TEXTO_LIMITE_PRIMERA}
          dia={estado.dia}
          horario={estado.horario}
          disponibilidad={disponibilidad}
          mensaje={estado.mensaje}
          onDia={(dia) => despachar({ tipo: "elegir_dia", dia })}
          onHorario={(horario) => despachar({ tipo: "elegir_horario", horario })}
          onReintentar={() => setReintentoDisponibilidad((n) => n + 1)}
        />
      ) : null}

      {paso === 4 ? (
        <PasoDireccion valor={estado.direccion} onCambio={(direccion) => despachar({ tipo: "cambiar_direccion", direccion })} />
      ) : null}

      {paso === 5 && estado.cotizacion && !cotizadaConEstaDireccion ? (
        errorDePago ? (
          <div>
            <p role="alert" className={estilos.error}>
              {errorDePago}
            </p>
            <div className={estilos.acciones}>
              <button type="button" className={estilos.boton} onClick={() => setReintentoPago((n) => n + 1)}>
                Reintentar
              </button>
              <button type="button" className={`${estilos.boton} ${estilos.botonSecundario}`} onClick={() => despachar({ tipo: "ir_a", paso: 4 })}>
                Revisar mis datos
              </button>
            </div>
          </div>
        ) : (
          <p className={estilos.ayuda} aria-live="polite">
            {cotizandoPago ? "Calculando tu precio con tu dirección..." : "Calculando tu precio..."}
          </p>
        )
      ) : null}

      {paso === 5 && estado.cotizacion && cotizadaConEstaDireccion ? (
        <PasoPago
          cotizacion={estado.cotizacion}
          metodo={estado.metodo}
          comprobante={estado.comprobante}
          subiendo={subiendo}
          errorDeArchivo={errorDeArchivo}
          mensaje={estado.mensaje}
          bloqueado={estado.bloqueado}
          enlaceBloqueo={estado.enlaceBloqueo}
          enviando={enviando}
          onMetodo={(metodo) => despachar({ tipo: "elegir_metodo", metodo })}
          onArchivo={alElegirArchivo}
          onConfirmar={alConfirmar}
          onRevisarDatos={() => despachar({ tipo: "ir_a", paso: 4 })}
        />
      ) : null}

      {paso === 6 && estado.reserva && estado.cotizacion ? (
        <PasoListo respuesta={estado.reserva} direccion={estado.direccion} esperaHoras={estado.cotizacion.espera_pago_horas} />
      ) : null}

      {paso < 6 ? (
        <div className={estilos.acciones}>
          {paso > 1 ? (
            <button type="button" className={`${estilos.boton} ${estilos.botonSecundario}`} onClick={() => despachar({ tipo: "atras" })}>
              Atrás
            </button>
          ) : null}
          {paso < 5 ? (
            <button type="button" className={estilos.boton} disabled={!puedeAvanzar(paso, estado)} onClick={() => despachar({ tipo: "siguiente" })}>
              Continuar
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
