import { redirect } from "next/navigation";
import { leerPerfilConZona } from "@/lib/perfil/resumen";
import { usuarioActual } from "@/lib/sesion";
import { CerrarSesion } from "./CerrarSesion";
import estilos from "./cuenta.module.css";
import { PerfilVista } from "./PerfilVista";

export const metadata = { title: "Mi cuenta · Tiza.com" };

// Perfil del cliente: membresía, avisos, próximas limpiezas e historial. Lee con las mismas funciones que `GET /api/perfil`
// (sin pasar por HTTP): la pasada de expiración corre antes de leer, y cada consulta lleva el `usuario_id` de la sesión.
export default async function Cuenta() {
  const usuario = await usuarioActual();
  if (!usuario) redirect("/ingresar?volver=/cuenta");
  const { perfil, zona } = await leerPerfilConZona({ usuario, ahora: new Date() });
  return (
    <main className={estilos.pagina}>
      <div className={estilos.contenido}>
        <PerfilVista usuario={{ id: usuario.id, nombre: usuario.nombre, correo: usuario.correo, celular: usuario.celular }} perfil={perfil} zona={zona} />
        <CerrarSesion />
      </div>
    </main>
  );
}
