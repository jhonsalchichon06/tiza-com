"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import estilos from "../formularios.module.css";

export function CerrarSesion() {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    setSaliendo(true);
    await fetch("/api/sesion", { method: "DELETE", headers: { "content-type": "application/json" } }).catch(() => null);
    router.replace("/ingresar");
    router.refresh();
  }

  return (
    <button className={`${estilos.boton} ${estilos.secundario}`} type="button" onClick={salir} disabled={saliendo}>
      {saliendo ? "Cerrando sesión…" : "Cerrar sesión"}
    </button>
  );
}
