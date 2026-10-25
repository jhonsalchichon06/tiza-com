"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent } from "react";
import { AVISO_DEMOSTRACION } from "@/lib/aviso-demo";
import { subirImagen } from "@/lib/imagenes/cliente";
import { reenviarDesdeElPerfil, type Candado } from "@/lib/perfil/reenvio-cliente";
import { TEXTO_PLAZO_VENCIDO } from "@/lib/perfil/avisos";
import type { Metodo } from "@/lib/reservas/asistente/estado";
import { CCI_TIZA, RUTA_QR_YAPE, TITULAR_TIZA } from "@/lib/reservas/datos-de-pago";
import estilos from "./cuenta.module.css";

// Subir otro comprobante tras un rechazo (perfil-reservas-y-membresia, decisión 10). Se muestra solo para los pagos de
// `pagosRechazadosReenviables`; el servidor vuelve a comprobar el plazo al enviar.

export const TEXTO_SIN_RESERVA_VIVA = "Si se aprueba tu pago, elegirás un nuevo día y hora sin pagar otra vez.";

export type EstadoDeReenvio = { tipo: "formulario" } | { tipo: "plazo_vencido"; mensaje: string } | { tipo: "enviado" };

type VistaProps = {
  metodo: Metodo | null;
  enviando: boolean;
  mensaje: string | null;
  estado: EstadoDeReenvio;
  // Hora límite de la espera de la reserva que sigue pendiente, ya escrita para mostrar; null si ya expiró.
  esperaHasta: string | null;
  onMetodo: (metodo: Metodo) => void;
  onArchivo: (archivo: File | null) => void;
  onEnviar: () => void;
};

export function VistaReenvio({ metodo, enviando, mensaje, estado, esperaHasta, onMetodo, onArchivo, onEnviar }: VistaProps) {
  if (estado.tipo === "plazo_vencido") {
    return (
      <div role="alert">
        <p className={estilos.error}>{estado.mensaje || TEXTO_PLAZO_VENCIDO}</p>
        <div className={estilos.acciones}>
          <a className={estilos.boton} href="/reservar">
            Empezar de nuevo
          </a>
        </div>
      </div>
    );
  }
  if (estado.tipo === "enviado") {
    return <p className={estilos.exito}>Recibimos tu comprobante. Lo estamos revisando.</p>;
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onEnviar();
      }}
    >
      <p className={estilos.dato}>
        {esperaHasta
          ? `Tu reserva conserva su horario hasta el ${esperaHasta}. Sube otro comprobante antes de esa hora.`
          : TEXTO_SIN_RESERVA_VIVA}
      </p>

      <fieldset className={estilos.grupo}>
        <legend className={estilos.grupoTitulo}>¿Cómo vas a pagar?</legend>
        <label className={estilos.opcion}>
          <input type="radio" name="metodo" value="yape" checked={metodo === "yape"} onChange={() => onMetodo("yape")} />
          Yape (escanea el código QR)
        </label>
        <label className={estilos.opcion}>
          <input type="radio" name="metodo" value="transferencia" checked={metodo === "transferencia"} onChange={() => onMetodo("transferencia")} />
          Transferencia (usa nuestra CCI)
        </label>
      </fieldset>

      <div className={estilos.datosPago}>
        <p role="note" className={estilos.avisoDemo}>
          {AVISO_DEMOSTRACION}
        </p>
        {metodo === "yape" ? (
          <>
            <img className={estilos.qr} src={RUTA_QR_YAPE} alt={`Código QR de Yape de Tiza, a nombre de ${TITULAR_TIZA}`} width={480} height={480} />
            <p className={estilos.dato}>Yape a nombre de {TITULAR_TIZA}</p>
          </>
        ) : metodo === "transferencia" ? (
          <>
            <p className={estilos.dato}>Código de cuenta interbancario (CCI)</p>
            <p className={estilos.cci}>{CCI_TIZA}</p>
            <p className={estilos.dato}>Titular: {TITULAR_TIZA}</p>
          </>
        ) : (
          <p className={estilos.dato}>Elige Yape o transferencia para ver los datos de pago.</p>
        )}
      </div>

      <label className={estilos.archivo}>
        Sube la foto o la captura de tu nuevo comprobante
        <input
          name="comprobante"
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          disabled={enviando}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onArchivo(e.target.files?.[0] ?? null)}
        />
      </label>
      <p className={estilos.mutado}>Imagen JPG, PNG o WebP, de hasta 5 MB.</p>

      {mensaje ? (
        <p role="alert" className={estilos.error}>
          {mensaje}
        </p>
      ) : null}

      <div className={estilos.acciones}>
        <button type="submit" className={estilos.boton} disabled={enviando}>
          {enviando ? "Enviando..." : "Enviar comprobante"}
        </button>
      </div>
    </form>
  );
}

type Props = { pagoId: string; usuarioId: string; esperaHasta: string | null };

export function ReenviarComprobante({ pagoId, usuarioId, esperaHasta }: Props) {
  const router = useRouter();
  const candado = useRef<Candado>({ enCurso: null });
  const [metodo, setMetodo] = useState<Metodo | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoDeReenvio>({ tipo: "formulario" });

  async function enviar() {
    setMensaje(null);
    setEnviando(true);
    const resultado = await reenviarDesdeElPerfil(
      { pagoId, metodo, archivo, usuarioId },
      { subir: subirImagen, pedir: (url, init) => fetch(url, init), candado: candado.current },
    );
    setEnviando(false);
    if (resultado.tipo === "ok") {
      setEstado({ tipo: "enviado" });
      router.refresh();
    } else if (resultado.tipo === "plazo_vencido") {
      setEstado({ tipo: "plazo_vencido", mensaje: resultado.mensaje });
    } else {
      setMensaje(resultado.mensaje);
    }
  }

  return <VistaReenvio metodo={metodo} enviando={enviando} mensaje={mensaje} estado={estado} esperaHasta={esperaHasta} onMetodo={setMetodo} onArchivo={setArchivo} onEnviar={enviar} />;
}
