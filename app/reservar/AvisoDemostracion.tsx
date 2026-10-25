import { AVISO_DEMOSTRACION } from "@/lib/aviso-demo";
import estilos from "./reservar.module.css";

// Aviso fijo de demostración (PRD, "Alcance" punto 3). El texto sale de la constante: no se escribe aquí.
export function AvisoDemostracion() {
  return (
    <p role="note" className={estilos.aviso}>
      {AVISO_DEMOSTRACION}
    </p>
  );
}
