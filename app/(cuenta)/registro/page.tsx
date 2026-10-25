import Link from "next/link";
import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/sesion";
import { destinoSeguro } from "@/lib/volver";
import { Formulario, type Campo } from "../Formulario";
import estilos from "../formularios.module.css";

export const metadata = { title: "Crea tu cuenta · Tiza.com" };

const CAMPOS: Campo[] = [
  { nombre: "nombre", etiqueta: "Nombre", tipo: "text", autocompletar: "name" },
  { nombre: "correo", etiqueta: "Correo", tipo: "email", autocompletar: "email" },
  { nombre: "celular", etiqueta: "Celular", tipo: "tel", autocompletar: "tel", ayuda: "9 dígitos, para coordinar por WhatsApp." },
  { nombre: "contrasena", etiqueta: "Contraseña", tipo: "password", autocompletar: "new-password", ayuda: "Al menos 8 caracteres." },
];

export default async function Registro({ searchParams }: { searchParams: Promise<{ volver?: string }> }) {
  if (await usuarioActual()) redirect("/cuenta");
  const volver = destinoSeguro((await searchParams).volver);
  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Crea tu cuenta</h1>
      <p className={estilos.ayuda}>Para reservar y ver tus limpiezas.</p>
      <Formulario campos={CAMPOS} endpoint="/api/sesion/registro" textoBoton="Crear cuenta" volver={volver} />
      <p>
        ¿Ya tienes cuenta?{" "}
        <Link className={estilos.enlace} href={`/ingresar?volver=${encodeURIComponent(volver)}`}>
          Inicia sesión
        </Link>
      </p>
    </main>
  );
}
