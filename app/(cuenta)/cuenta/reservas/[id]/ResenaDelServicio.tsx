"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ResenaVista } from "@/lib/perfil/detalle";
import { estrellasEnTexto, etiquetaDeEstrellas } from "@/lib/resenas/estrellas";
import { COMENTARIO_MAX, largoDelComentario } from "@/lib/resenas/limites";
import { esEditable, textoDeEstadoResena } from "@/lib/resenas/textos";
import { leerError, MENSAJE_SIN_CONEXION } from "@/lib/reservas/asistente/api-cliente";
import estilos from "../../cuenta.module.css";
import estilosResena from "./resena.module.css";

export const MENSAJE_ELIGE_ESTRELLAS = "Elige de 1 a 5 estrellas.";
export const TEXTO_RESENA_ENVIADA = "Recibimos tu reseña. La revisaremos antes de mostrarla en la web.";
const etiquetaDeOpcion = (n: number) => `${n} ${n === 1 ? "estrella" : "estrellas"}`;

type Props = {
  reservaId: string;
  resena: ResenaVista | null;
  puedeResenar: boolean;
};

// Reseña de una limpieza completada: un formulario de estrellas (botones de opción, se opera con teclado y lector de pantalla)
// y comentario, o la reseña ya enviada con su estado. Una aprobada se muestra sin formulario (ya no se edita). Los textos del
// cliente se muestran como hijos de React (escapados). El servidor valida todo; aquí solo se evita un envío vacío.
export function ResenaDelServicio({ reservaId, resena, puedeResenar }: Props) {
  const router = useRouter();
  const [estrellas, setEstrellas] = useState(resena?.estrellas ?? 0);
  const [comentario, setComentario] = useState(resena?.comentario ?? "");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviada, setEnviada] = useState(false);

  if (!resena && !puedeResenar) return null;

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (estrellas < 1) {
      setError(MENSAJE_ELIGE_ESTRELLAS);
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const respuesta = await fetch(`/api/reservas/${reservaId}/resena`, {
        method: resena ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estrellas, comentario }),
      });
      if (!respuesta.ok) {
        setError((await leerError(respuesta)).mensaje);
        if (respuesta.status === 409) router.refresh();
        return;
      }
      setEnviada(true);
      router.refresh();
    } catch {
      setError(MENSAJE_SIN_CONEXION);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className={estilos.tarjeta} aria-label="Tu reseña">
      <p className={estilos.tarjetaTitulo}>Tu reseña</p>
      {resena ? (
        <>
          <p className={estilos.dato}>
            <span className={estilosResena.estrellasLeidas} role="img" aria-label={etiquetaDeEstrellas(resena.estrellas)}>
              {estrellasEnTexto(resena.estrellas)}
            </span>
          </p>
          <p className={`${estilos.dato} ${estilosResena.texto}`}>{resena.comentario}</p>
          <p className={estilos.dato}>
            <span className={estilos.etiqueta}>{textoDeEstadoResena(resena.estado)}</span>
          </p>
        </>
      ) : (
        <p className={estilos.dato}>Cuéntanos cómo te fue con tu limpieza. La revisamos antes de mostrarla en la web.</p>
      )}

      {!resena || esEditable(resena.estado) ? (
        <form onSubmit={enviar} noValidate>
          <fieldset className={estilos.grupo}>
            <legend className={estilos.grupoTitulo}>{resena ? "Editar mi reseña" : "¿Cómo fue tu limpieza?"}</legend>
            <div className={estilosResena.estrellas}>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className={estilosResena.estrella}>
                  <input type="radio" name="estrellas" value={n} checked={estrellas === n} onChange={() => setEstrellas(n)} />
                  {etiquetaDeOpcion(n)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className={estilos.campo}>
            Tu comentario
            <textarea
              className={estilosResena.comentario}
              name="comentario"
              rows={5}
              maxLength={COMENTARIO_MAX}
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
            />
            <span className={estilosResena.contador}>
              {largoDelComentario(comentario)} de {COMENTARIO_MAX}
            </span>
          </label>
          {error ? (
            <p role="alert" className={estilos.error}>
              {error}
            </p>
          ) : null}
          {enviada && !error ? (
            <p role="status" className={estilos.exito}>
              {TEXTO_RESENA_ENVIADA}
            </p>
          ) : null}
          <div className={estilos.acciones}>
            <button type="submit" className={`${estilos.boton} ${estilosResena.enviar}`} disabled={enviando}>
              {enviando ? "Enviando..." : resena ? "Guardar y enviar de nuevo" : "Enviar reseña"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
