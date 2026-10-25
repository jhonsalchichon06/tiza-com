"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent } from "react";
import { AVISO_DEMOSTRACION } from "@/lib/aviso-demo";
import { subirImagen } from "@/lib/imagenes/cliente";
import { renovarDesdeElPerfil, type Candado } from "@/lib/membresia/renovar-cliente";
import type { Metodo } from "@/lib/reservas/asistente/estado";
import { CCI_TIZA, RUTA_QR_YAPE, TITULAR_TIZA } from "@/lib/reservas/datos-de-pago";
import estilos from "./renovar.module.css";

// Pantalla de pago de la renovación (renovacion-del-mes-4, decisión 8). El monto y la duración llegan escritos desde el
// servidor (`planDeRenovacion`): este componente no calcula ni conoce ninguna cifra.

type VistaProps = {
  monto: string;
  duracion: string;
  metodo: Metodo | null;
  enviando: boolean;
  mensaje: string | null;
  enviado: boolean;
  onMetodo: (metodo: Metodo) => void;
  onArchivo: (archivo: File | null) => void;
  onEnviar: () => void;
};

export function VistaRenovacion({ monto, duracion, metodo, enviando, mensaje, enviado, onMetodo, onArchivo, onEnviar }: VistaProps) {
  if (enviado) {
    return (
      <div>
        <p className={estilos.exito}>Recibimos tu comprobante. Lo estamos revisando; cuando lo aprobemos podrás elegir día y hora desde tu perfil.</p>
        <div className={estilos.acciones}>
          <a className={estilos.boton} href="/cuenta">
            Ir a mi cuenta
          </a>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onEnviar();
      }}
    >
      <section className={estilos.resumen} aria-label="Resumen de tu pago">
        <p className={estilos.resumenTitulo}>Renovar mi membresía por {duracion}</p>
        <p className={estilos.resumenMonto}>{monto}</p>
        <p className={estilos.mutado}>
          Se paga en un solo pago por adelantado y no se reembolsa. Tus {duracion} empiezan a contar cuando aprobemos tu pago.
        </p>
      </section>

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
        Sube la foto o la captura de tu comprobante
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

export function FormularioRenovacion({ usuarioId, monto, duracion }: { usuarioId: string; monto: string; duracion: string }) {
  const router = useRouter();
  const candado = useRef<Candado>({ enCurso: null });
  const [metodo, setMetodo] = useState<Metodo | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  async function enviar() {
    setMensaje(null);
    setEnviando(true);
    const resultado = await renovarDesdeElPerfil({ metodo, archivo, usuarioId }, { subir: subirImagen, pedir: (url, init) => fetch(url, init), candado: candado.current });
    setEnviando(false);
    if (resultado.tipo === "ok") {
      setEnviado(true);
      router.refresh();
    } else {
      setMensaje(resultado.mensaje);
    }
  }

  return (
    <VistaRenovacion
      monto={monto}
      duracion={duracion}
      metodo={metodo}
      enviando={enviando}
      mensaje={mensaje}
      enviado={enviado}
      onMetodo={setMetodo}
      onArchivo={setArchivo}
      onEnviar={enviar}
    />
  );
}
