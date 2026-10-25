import { CamposDireccion } from "../_componentes/CamposDireccion";
import type { DireccionEscrita } from "@/lib/reservas/asistente/estado";
import estilos from "./reservar.module.css";

type Props = { valor: DireccionEscrita; onCambio: (valor: DireccionEscrita) => void };

// Solo la dirección del hogar: el contacto sale de la cuenta (no se pide nada más).
export function PasoDireccion({ valor, onCambio }: Props) {
  return (
    <div>
      <p className={estilos.ayuda}>Escribe la dirección donde haremos la limpieza.</p>
      <CamposDireccion valor={valor} onCambio={onCambio} />
    </div>
  );
}
