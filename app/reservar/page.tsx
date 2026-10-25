import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/cliente";
import { membresias } from "@/db/esquema";
import { errorOriginal } from "@/lib/agenda/errores-bd";
import { leerConfiguracion } from "@/lib/configuracion";
import { formatearFecha } from "@/lib/perfil/textos";
import { leerParametrosIniciales, rutaDeVolver, type ParametrosDeUrl } from "@/lib/reservas/asistente/parametros";
import { decidirVista } from "@/lib/reservas/asistente/vista";
import { conReintento } from "@/lib/reintento";
import { usuarioActual } from "@/lib/sesion";
import { Asistente } from "./Asistente";
import { Marco } from "./Marco";
import { MembresiaVencida, PagoEnRevision } from "./VistasDeMembresia";

export const metadata = { title: "Reserva tu limpieza · Tiza.com" };

// Se lee la sesión y la base en cada petición: nada de esto puede quedar en caché.
export const dynamic = "force-dynamic";

export default async function Reservar({ searchParams }: { searchParams: Promise<ParametrosDeUrl> }) {
  const parametros = await searchParams;
  const usuario = await usuarioActual();
  if (!usuario) redirect(`/registro?volver=${encodeURIComponent(rutaDeVolver(parametros))}`);

  // Un solo intento extra si Neon estaba dormido (ADR 0006).
  // La vigencia ('fin > now()') la calcula la base: el reloj del servidor no decide quién es miembro.
  const { filas, config } = await conReintento(async () => {
    try {
      const filas = await db()
        .select({ estado: membresias.estado, fin: membresias.fin, vigente: sql<boolean>`${membresias.fin} > now()` })
        .from(membresias)
        .where(eq(membresias.usuarioId, usuario.id));
      return { filas, config: await leerConfiguracion() };
    } catch (error) {
      throw errorOriginal(error);
    }
  });

  const vista = decidirVista(
    usuario,
    filas.map((f) => ({ estado: f.estado, vigente: f.vigente === true })),
  );

  if (vista === "pago_en_revision") return <PagoEnRevision />;

  if (vista === "membresia_vencida") {
    // La membresía `activa` que llegó más lejos es la que venció por última vez.
    const fin = filas.filter((f) => f.estado === "activa" && f.fin).sort((a, b) => (b.fin as Date).getTime() - (a.fin as Date).getTime())[0]?.fin;
    return <MembresiaVencida fecha={fin ? formatearFecha(fin, config.horario_atencion.zona) : null} />;
  }

  const paquetes = config.paquetes_horas;
  return (
    <Marco>
      <Asistente
        usuarioId={usuario.id}
        inicial={leerParametrosIniciales(parametros, paquetes.map((p) => p.horas))}
        paquetes={paquetes}
      />
    </Marco>
  );
}
