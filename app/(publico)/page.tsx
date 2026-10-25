import { leerCatalogo } from "@/lib/leer-catalogo";
import { leerOpiniones } from "@/lib/resenas/publicas";
import { Landing } from "./_componentes/Landing";

export const metadata = {
  title: "Tiza.com · Limpieza de hogares en Lima",
  description:
    "Las primeras horas de limpieza gratis con la membresía Tiza Club. Limpieza profesional por horas o por tamaño de hogar en Lima, con personal propio y precio claro en soles.",
};

// Se regenera como máximo cada 5 minutos: editar `configuracion` se ve sin desplegar (ADR 0008).
export const revalidate = 300;

export default async function Inicio() {
  // Las opiniones (ítem 18) nunca hacen fallar la landing: si la lectura falla, se publica sin la sección.
  const [catalogo, opiniones] = await Promise.all([leerCatalogo(), leerOpiniones()]);
  return <Landing catalogo={catalogo} opiniones={opiniones} />;
}
