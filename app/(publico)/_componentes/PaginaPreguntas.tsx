import Link from "next/link";
import type { Catalogo } from "@/lib/catalogo-publico";
import { construirPreguntas } from "@/lib/preguntas";
import e from "../landing.module.css";
import { ListaPreguntas } from "./Secciones";

export function PaginaPreguntas({ catalogo }: { catalogo: Catalogo }) {
  return (
    <main className={e.pagPreguntas}>
      <div className={`${e.wrap} ${e.faq}`}>
        <Link href="/" className={`${e.link} ${e.volver}`}>
          ← Volver al inicio
        </Link>
        <h1>Preguntas frecuentes</h1>
        <ListaPreguntas preguntas={construirPreguntas(catalogo)} />
      </div>
    </main>
  );
}
