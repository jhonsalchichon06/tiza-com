"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import estilos from "./formularios.module.css";

export type Campo = { nombre: string; etiqueta: string; tipo: string; autocompletar: string; ayuda?: string };

type Props = {
  campos: Campo[];
  endpoint: string;
  textoBoton: string;
  volver?: string; // adónde ir al terminar bien; sin él se muestra mensajeExito
  mensajeExito?: string;
  extra?: Record<string, string>; // datos fijos que viajan con el formulario (por ejemplo, el token de un enlace)
  ofrecerNuevoEnlace?: boolean; // ante enlace_invalido, ofrece pedir otro en /olvide
};

// Envía los datos como JSON; ante un error lo muestra sin borrar lo escrito.
export function Formulario({ campos, endpoint, textoBoton, volver, mensajeExito, extra, ofrecerNuevoEnlace }: Props) {
  const router = useRouter();
  const [valores, setValores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [codigoError, setCodigoError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    setCodigoError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...valores, ...extra }),
      });
      if (res.ok) {
        if (volver) {
          router.replace(volver);
          router.refresh();
          return;
        }
        setListo(true);
        setEnviando(false);
        return;
      }
      const cuerpo = await res.json().catch(() => null);
      setError(cuerpo?.error?.mensaje ?? "Algo salió mal. Inténtalo de nuevo.");
      setCodigoError(cuerpo?.error?.codigo ?? null);
    } catch {
      setError("No pudimos conectarnos. Revisa tu internet e inténtalo de nuevo.");
    }
    setEnviando(false);
  }

  if (listo && mensajeExito) {
    return (
      <p className={estilos.ayuda} role="status">
        {mensajeExito}
      </p>
    );
  }

  return (
    <form className={estilos.formulario} onSubmit={enviar} noValidate>
      {campos.map((c) => (
        <label key={c.nombre} className={estilos.campo}>
          {c.etiqueta}
          <input
            name={c.nombre}
            type={c.tipo}
            autoComplete={c.autocompletar}
            value={valores[c.nombre] ?? ""}
            onChange={(e) => setValores({ ...valores, [c.nombre]: e.target.value })}
            aria-describedby={c.ayuda ? `${c.nombre}-ayuda` : undefined}
            required
          />
          {c.ayuda && <small id={`${c.nombre}-ayuda`}>{c.ayuda}</small>}
        </label>
      ))}
      {error && (
        <p className={estilos.error} role="alert">
          {error}
        </p>
      )}
      {ofrecerNuevoEnlace && codigoError === "enlace_invalido" && (
        <Link className={estilos.enlace} href="/olvide">
          Pedir un enlace nuevo
        </Link>
      )}
      <button className={estilos.boton} type="submit" disabled={enviando}>
        {enviando ? "Un momento…" : textoBoton}
      </button>
    </form>
  );
}
