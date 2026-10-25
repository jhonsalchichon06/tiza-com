import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/sesion";

// Todo /admin exige rol admin, leído de la base en cada petición.
export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const usuario = await usuarioActual();
  if (!usuario) redirect("/ingresar?volver=/admin");
  if (usuario.rol !== "admin") redirect("/cuenta");
  return children;
}
