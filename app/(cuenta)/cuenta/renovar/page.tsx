import { redirect } from "next/navigation";
import { pantallaDeRenovar } from "@/lib/membresia/pantalla-renovar";
import { leerPerfilConZona } from "@/lib/perfil/resumen";
import { usuarioActual } from "@/lib/sesion";
import { FormularioRenovacion } from "./FormularioRenovacion";
import estilos from "./renovar.module.css";

export const metadata = { title: "Renovar mi membresía · Tiza.com" };

// Se lee la sesión y la base en cada petición: nada de esto puede quedar en caché.
export const dynamic = "force-dynamic";

// Pago de la renovación. Lee con la misma función que `GET /api/perfil` (la pasada de expiración corre antes y se reintenta
// una vez si Neon estaba dormido): solo el cliente con la membresía vencida y sin renovación en curso ve el formulario.
export default async function Renovar() {
  const usuario = await usuarioActual();
  if (!usuario) redirect("/ingresar?volver=/cuenta/renovar");
  const { perfil } = await leerPerfilConZona({ usuario, ahora: new Date() });
  const pantalla = pantallaDeRenovar(perfil.renovacion);
  if (pantalla.tipo === "redirigir") redirect(pantalla.a);
  return (
    <main className={estilos.pagina}>
      <div className={estilos.contenido}>
        <a className={estilos.volver} href="/cuenta">
          Volver a mi cuenta
        </a>
        <h1 className={estilos.titulo}>Renovar mi membresía</h1>
        <p className={estilos.subtitulo}>Paga de nuevo para seguir eligiendo día y hora de tus limpiezas.</p>
        <FormularioRenovacion usuarioId={usuario.id} monto={pantalla.monto} duracion={pantalla.duracion} />
      </div>
    </main>
  );
}
