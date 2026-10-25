import Link from "next/link";
import estilos from "./pagos/pagos.module.css";

// Portada del portal: enlaces a los pagos por revisar (ítem 11), a las reservas y el apoyo por coordinar (ítem 16) y a las
// reseñas por revisar (ítem 18, con cuántas hay) y al crédito en horas de cada cliente (ítem 14, solo lectura). `pendientesResenas` es null si no se pudo contar: el enlace sale sin número.
export function VistaAdmin({ pendientesResenas }: { pendientesResenas: number | null }) {
  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Portal de administración</h1>
      <p className={estilos.ayuda}>Aquí verás los pagos por revisar, las reservas, el apoyo por coordinar, las reseñas por revisar y el crédito en horas.</p>
      <p>
        <Link href="/admin/pagos">Pagos por revisar</Link>
      </p>
      <p>
        <Link href="/admin/reservas">Reservas</Link>
      </p>
      <p>
        <Link href="/admin/apoyo">Apoyo por coordinar</Link>
      </p>
      <p>
        <Link href="/admin/creditos">Crédito en horas</Link>
      </p>
      <p>
        <Link href="/admin/resenas">{pendientesResenas === null ? "Reseñas por revisar" : `Reseñas por revisar (${pendientesResenas})`}</Link>
      </p>
    </main>
  );
}
