import type { TipoDeServicio } from "@/lib/reservas/asistente/parametros";
import { NOMBRES_DE_SERVICIO } from "@/lib/reservas/asistente/nombres";
import estilos from "./reservar.module.css";

// Las descripciones no llevan cifras: las duraciones y los precios los da el servidor en el paso siguiente.
const SERVICIOS: { valor: TipoDeServicio; nombre: string; detalle: string }[] = [
  { valor: "estandar", nombre: NOMBRES_DE_SERVICIO.estandar, detalle: "Mantenimiento de tu hogar, según su tamaño." },
  { valor: "profunda", nombre: NOMBRES_DE_SERVICIO.profunda, detalle: "Más a fondo: rincones, cocina y baños." },
  { valor: "mudanza", nombre: NOMBRES_DE_SERVICIO.mudanza, detalle: "Para dejar listo un departamento al alquilar o devolver." },
  { valor: "paquete", nombre: NOMBRES_DE_SERVICIO.paquete, detalle: "Tú eliges cuánto tiempo de limpieza necesitas." },
];

type Props = { tipo: TipoDeServicio | null; onElegir: (tipo: TipoDeServicio) => void };

export function PasoServicio({ tipo, onElegir }: Props) {
  return (
    <fieldset className={estilos.grupo}>
      <legend className={estilos.grupoTitulo}>¿Qué tipo de limpieza necesitas?</legend>
      <div className={estilos.opciones}>
        {SERVICIOS.map((s) => (
          <label key={s.valor} className={estilos.opcion}>
            <input type="radio" name="servicio" value={s.valor} checked={tipo === s.valor} onChange={() => onElegir(s.valor)} />
            <span className={estilos.opcionNombre}>{s.nombre}</span>
            <span className={estilos.opcionDetalle}>{s.detalle}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
