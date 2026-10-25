import Link from "next/link";
import { redirect } from "next/navigation";
import { MENSAJE_OLVIDE } from "@/lib/rutas-sesion";
import { usuarioActual } from "@/lib/sesion";
import { Formulario, type Campo } from "../Formulario";
import estilos from "../formularios.module.css";

export const metadata = { title: "Olvidé mi contraseña · Tiza.com" };

const CAMPOS: Campo[] = [{ nombre: "correo", etiqueta: "Correo", tipo: "email", autocompletar: "email" }];

export default async function Olvide() {
  if (await usuarioActual()) redirect("/cuenta");
  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>¿Olvidaste tu contraseña?</h1>
      <p className={estilos.ayuda}>Escribe tu correo y te enviamos un enlace para elegir una nueva.</p>
      <Formulario campos={CAMPOS} endpoint="/api/sesion/olvide" textoBoton="Enviar enlace" mensajeExito={MENSAJE_OLVIDE} />
      <p>
        <Link className={estilos.enlace} href="/ingresar">
          Volver a iniciar sesión
        </Link>
      </p>
    </main>
  );
}
