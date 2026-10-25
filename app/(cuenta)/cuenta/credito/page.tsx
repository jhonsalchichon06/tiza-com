import { redirect } from "next/navigation";
import { leerCreditosParaPagina } from "@/lib/creditos/pantalla";
import { usuarioActual } from "@/lib/sesion";
import estilos from "../cuenta.module.css";
import { CreditoVista } from "./CreditoVista";

export const metadata = { title: "Mi crédito · Tiza.com" };

// Se lee la sesión y la base en cada petición: nada de esto puede quedar en caché.
export const dynamic = "force-dynamic";

// Detalle del crédito en horas: lotes con su vencimiento y de dónde salió y en qué se usó cada hora (PRD, alcance punto 7).
export default async function Credito() {
  const usuario = await usuarioActual();
  if (!usuario) redirect("/ingresar?volver=/cuenta/credito");
  const { creditos, zona } = await leerCreditosParaPagina(usuario.id);
  return (
    <main className={estilos.pagina}>
      <div className={estilos.contenido}>
        <a className={estilos.volver} href="/cuenta">
          Volver a mi cuenta
        </a>
        <CreditoVista creditos={creditos} zona={zona} />
      </div>
    </main>
  );
}
