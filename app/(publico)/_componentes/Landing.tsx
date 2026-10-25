import type { Catalogo } from "@/lib/catalogo-publico";
import { construirPreguntas } from "@/lib/preguntas";
import type { Opinion } from "@/lib/resenas/publicas";
import e from "../landing.module.css";
import { Opiniones } from "./Opiniones";
import { ComoFunciona, Club, Distritos, Franja, Hero, ListaPreguntas, LlamadaFinal, Paquetes, Servicios } from "./Secciones";

// Contenido de `/` (sin cabecera ni pie: los pone el layout del grupo). La sección de opiniones (ítem #18) solo existe si hay
// al menos una reseña aprobada: sin ellas no hay sección, ni enlace, ni frase sustituta, y nunca testimonios de ejemplo.
export function Landing({ catalogo, opiniones = [] }: { catalogo: Catalogo; opiniones?: Opinion[] }) {
  return (
    <main>
      <Hero catalogo={catalogo} />
      <Franja catalogo={catalogo} />
      <ComoFunciona catalogo={catalogo} />
      <Servicios catalogo={catalogo} />
      <Paquetes catalogo={catalogo} />
      <Club catalogo={catalogo} />
      {opiniones.length > 0 ? <Opiniones opiniones={opiniones} /> : null}
      <Distritos catalogo={catalogo} />
      <section className={`${e.sec} ${e.secAlt}`} id="faq">
        <div className={`${e.wrap} ${e.faq}`}>
          <h2 className={e.secT}>Preguntas frecuentes</h2>
          <ListaPreguntas preguntas={construirPreguntas(catalogo)} />
        </div>
      </section>
      <LlamadaFinal catalogo={catalogo} />
    </main>
  );
}
