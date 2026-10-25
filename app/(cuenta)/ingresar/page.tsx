import Link from "next/link";
import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/sesion";
import { destinoSeguro } from "@/lib/volver";
import { Formulario, type Campo } from "../Formulario";
import estilos from "../formularios.module.css";

export const metadata = { title: "Inicia sesión · Tiza.com" };

const CAMPOS: Campo[] = [
  { nombre: "correo", etiqueta: "Correo", tipo: "email", autocompletar: "email" },
  { nombre: "contrasena", etiqueta: "Contraseña", tipo: "password", autocompletar: "current-password" },
];

export default async function Ingresar({ searchParams }: { searchParams: Promise<{ volver?: string }> }) {
  if (await usuarioActual()) redirect("/cuenta");
  const volver = destinoSeguro((await searchParams).volver);
  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Inicia sesión</h1>
      <Formulario campos={CAMPOS} endpoint="/api/sesion" textoBoton="Entrar" volver={volver} />
      <p>
        <Link className={estilos.enlace} href="/olvide">
          ¿Olvidaste tu contraseña?
        </Link>
      </p>
      <p>
        ¿No tienes cuenta?{" "}
        <Link className={estilos.enlace} href={`/registro?volver=${encodeURIComponent(volver)}`}>
          Créala aquí
        </Link>
      </p>
    </main>
  );
}
