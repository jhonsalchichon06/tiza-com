import Link from "next/link";
import { Fraunces, Inter } from "next/font/google";
import { leerOpiniones } from "@/lib/resenas/publicas";
import { enlaceWhatsApp } from "@/lib/whatsapp";
import e from "./landing.module.css";
import { PieSitio } from "./_componentes/PieSitio";

const titulos = Fraunces({ subsets: ["latin"], weight: ["600", "700"], variable: "--fuente-titulo", display: "swap" });
const textos = Inter({ subsets: ["latin"], variable: "--fuente-texto", display: "swap" });

// Sin cookies() ni headers(): las páginas públicas se prerrenderizan y se regeneran (ISR).
// El enlace «Opiniones» solo aparece si hay reseñas aprobadas (la misma lectura que la página, con `cache`).
export default async function LayoutPublico({ children }: { children: React.ReactNode }) {
  const whatsapp = enlaceWhatsApp(process.env.WHATSAPP_NUMERO);
  const hayOpiniones = (await leerOpiniones()).length > 0;
  return (
    <div className={`${e.sitio} ${titulos.variable} ${textos.variable}`}>
      <Link href="/reservar?club=1" className={e.promo}>
        🎁 <b>Primeras horas GRATIS</b> con la membresía Tiza Club · <u>Reservar ahora →</u>
      </Link>
      <header className={e.nav}>
        <div className={`${e.wrap} ${e.navIn}`}>
          <Link href="/" className={e.logo} aria-label="Tiza.com">
            <span className={e.logoMark}>✦</span>tiza<span className={e.logoDot}>.com</span>
          </Link>
          <nav className={e.navLinks}>
            <Link href="/#como-funciona">Cómo funciona</Link>
            <Link href="/#servicios">Servicios</Link>
            <Link href="/#paquetes">Paquetes por hora</Link>
            <Link href="/#club">Tiza Club</Link>
            {hayOpiniones ? <Link href="/#opiniones">Opiniones</Link> : null}
            <Link href="/preguntas">Preguntas</Link>
          </nav>
          <Link href="/ingresar" className={e.navAuth}>
            Ingresar
          </Link>
          <Link href="/reservar" className={`${e.btn} ${e.btnSm}`}>
            Cotizar ahora
          </Link>
        </div>
      </header>
      {children}
      <PieSitio whatsapp={whatsapp} />
      {whatsapp ? (
        <a className={e.wa} href={whatsapp} aria-label="Escríbenos por WhatsApp">
          <img src="/assets/whatsapp.svg" alt="" width={28} height={28} />
        </a>
      ) : null}
    </div>
  );
}
