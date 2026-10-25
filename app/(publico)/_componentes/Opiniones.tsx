import { estrellasEnTexto, etiquetaDeEstrellas } from "@/lib/resenas/estrellas";
import type { Opinion } from "@/lib/resenas/publicas";
import e from "../landing.module.css";

// Opiniones reales de clientes, ya aprobadas por el administrador (PRD, alcance 7 y 9). Solo se muestra lo que trae `Opinion`:
// nombre de pila, distrito, estrellas, comentario y mes. El texto del cliente va como hijo de React (escapado), nunca como HTML.
// La sección no existe si no hay ninguna: el llamador decide (ni título ni frase sustituta).
export function Opiniones({ opiniones }: { opiniones: Opinion[] }) {
  return (
    <section className={e.sec} id="opiniones">
      <div className={e.wrap}>
        <h2 className={e.secT}>Opiniones de clientes</h2>
        <ul className={e.opiniones}>
          {opiniones.map((o, i) => (
            <li key={i} className={`${e.card} ${e.opinion}`}>
              <span className={e.opinionEstrellas} role="img" aria-label={etiquetaDeEstrellas(o.estrellas)}>
                {estrellasEnTexto(o.estrellas)}
              </span>
              <p className={e.opinionTexto}>{o.comentario}</p>
              <p className={e.opinionPie}>
                <b>{o.nombrePila}</b> · {o.distrito} · {o.mes}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
