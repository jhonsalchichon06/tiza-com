import Link from "next/link";
import { Formulario, type Campo } from "../Formulario";
import estilos from "../formularios.module.css";

// El token viaja en la URL: que no salga hacia otros sitios en el Referer.
export const metadata = { title: "Nueva contraseña · Tiza.com", referrer: "no-referrer" as const };

const CAMPOS: Campo[] = [
  {
    nombre: "contrasena",
    etiqueta: "Contraseña nueva",
    tipo: "password",
    autocompletar: "new-password",
    ayuda: "Mínimo 8 caracteres.",
  },
];

export default async function Restablecer({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <main className={estilos.pagina}>
        <h1 className={estilos.titulo}>Enlace no válido</h1>
        <p className={estilos.ayuda}>Este enlace no es válido o ya venció. Pide uno nuevo.</p>
        <Link className={estilos.enlace} href="/olvide">
          Pedir un enlace nuevo
        </Link>
      </main>
    );
  }
  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Elige tu contraseña nueva</h1>
      <Formulario
        campos={CAMPOS}
        endpoint="/api/sesion/restablecer"
        textoBoton="Guardar contraseña"
        volver="/ingresar"
        extra={{ token }}
        ofrecerNuevoEnlace
      />
    </main>
  );
}
