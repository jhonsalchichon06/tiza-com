import Link from "next/link";
import { AVISO_DEMOSTRACION } from "@/lib/aviso-demo";
import e from "../landing.module.css";

// Pie de todas las páginas públicas. El aviso de demostración (PRD, "Alcance" punto 3) va en un bloque visible
// aparte; su texto vive solo en src/lib/aviso-demo.ts.
export function PieSitio({ whatsapp }: { whatsapp: string | null }) {
  return (
    <footer className={e.foot}>
      <div className={`${e.wrap} ${e.footIn}`}>
        <div>
          <Link href="/" className={`${e.logo} ${e.logoLight}`}>
            <span className={e.logoMark}>✦</span>tiza<span className={e.logoDot}>.com</span>
          </Link>
          <p>Limpieza de hogares en Lima, Perú.</p>
        </div>
        <div>
          <b>Servicios</b>
          <Link href="/#servicios">Estándar, profunda y mudanza</Link>
          <Link href="/#paquetes">Por horas</Link>
        </div>
        <div>
          <b>Tiza</b>
          <Link href="/#club">Tiza Club</Link>
          <Link href="/preguntas">Preguntas</Link>
        </div>
        <div>
          <b>Contacto</b>
          {whatsapp ? <a href={whatsapp}>WhatsApp</a> : <span>Escríbenos desde tu cuenta</span>}
        </div>
      </div>
      <div className={e.wrap}>
        <p className={e.aviso} role="note">
          {AVISO_DEMOSTRACION}
        </p>
        <p className={e.footC}>© Tiza.com · Lima, Perú</p>
      </div>
    </footer>
  );
}
