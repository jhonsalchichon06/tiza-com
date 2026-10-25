import { leerCatalogo } from "@/lib/leer-catalogo";
import { PaginaPreguntas } from "../_componentes/PaginaPreguntas";

export const metadata = {
  title: "Preguntas frecuentes · Tiza.com",
  description: "Resolvemos tus dudas sobre Tiza Club, los pagos, los horarios y la cobertura.",
};

export const revalidate = 300;

export default async function Preguntas() {
  return <PaginaPreguntas catalogo={await leerCatalogo()} />;
}
