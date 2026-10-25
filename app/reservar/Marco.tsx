import Link from "next/link";
import type { ReactNode } from "react";
import estilos from "./reservar.module.css";

// Marco de la página /reservar: barra con el logo y el contenedor central. Los estilos son de este módulo.
export function Marco({ children }: { children: ReactNode }) {
  return (
    <div className={estilos.raiz}>
      <header className={estilos.barra}>
        <div className={estilos.barraInterior}>
          <Link href="/" className={estilos.logo}>
            Tiza<span className={estilos.logoPunto}>.com</span>
          </Link>
        </div>
      </header>
      <main className={estilos.contenido}>{children}</main>
    </div>
  );
}
