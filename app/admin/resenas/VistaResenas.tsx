import Link from "next/link";
import type { ResenaPendiente } from "@/lib/resenas/moderar";
import { estrellasEnTexto, etiquetaDeEstrellas } from "@/lib/resenas/estrellas";
import { fechaYHora } from "../pagos/formato";
import { AccionesResena } from "./AccionesResena";
import estilos from "./resenas.module.css";

// Cola de reseñas por revisar. El comentario y el nombre son texto libre del cliente: se muestran SIEMPRE como hijos de React
// (escapados), nunca como HTML. `white-space: pre-line` conserva los saltos de línea.
export function VistaResenas({ resenas }: { resenas: ResenaPendiente[] }) {
  return (
    <main className={estilos.pagina}>
      <Link href="/admin" className={estilos.volver}>
        ← Portal de administración
      </Link>
      <h1 className={estilos.titulo}>Reseñas por revisar</h1>
      <p className={estilos.ayuda}>Aprueba las reseñas que se pueden mostrar en la web. Las más antiguas aparecen primero.</p>
      <p className={estilos.aviso}>Revisa que el comentario no tenga datos personales: se publicará tal cual.</p>
      {resenas.length === 0 ? (
        <p className={estilos.vacio}>No hay reseñas por revisar</p>
      ) : (
        <ul className={estilos.lista}>
          {resenas.map((r) => (
            <li key={r.id} className={estilos.tarjeta}>
              <div className={estilos.cabecera}>
                <span className={estilos.cliente}>{r.cliente}</span>
                <span className={estilos.estrellas} role="img" aria-label={etiquetaDeEstrellas(r.estrellas)}>
                  {estrellasEnTexto(r.estrellas)}
                </span>
              </div>
              <span className={estilos.detalle}>
                Limpieza del {fechaYHora(r.inicio)} · {r.distrito} · reseña enviada el {fechaYHora(r.creada_en)}
              </span>
              <p className={estilos.comentario}>{r.comentario}</p>
              <AccionesResena id={r.id} revision={r.revision} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
