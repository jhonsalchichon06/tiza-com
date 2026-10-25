import type { TipoDeServicio } from "@/lib/reservas/asistente/parametros";
import { mensajeDeTamano } from "@/lib/reservas/asistente/estado";
import type { Cotizacion } from "@/lib/reservas/cotizar";
import { formatearHoras, formatearSoles } from "@/lib/soles";
import { ResumenCotizacion } from "./ResumenCotizacion";
import estilos from "./reservar.module.css";

export type PaqueteDeHoras = { horas: number; precio: number };

type Props = {
  tipo: TipoDeServicio;
  dormitorios: number | null;
  banos: number | null;
  horasPaquete: number | null;
  paquetes: PaqueteDeHoras[]; // de la configuración (los pasa el servidor)
  cotizacion: Cotizacion | null;
  cargando: boolean;
  errorDeCotizacion: string | null;
  onDormitorios: (valor: number | null) => void;
  onBanos: (valor: number | null) => void;
  onPaquete: (horas: number) => void;
  onReintentar: () => void;
};

const leerNumero = (texto: string): number | null => (texto.trim() === "" ? null : Number(texto));

export function PasoTamano({
  tipo,
  dormitorios,
  banos,
  horasPaquete,
  paquetes,
  cotizacion,
  cargando,
  errorDeCotizacion,
  onDormitorios,
  onBanos,
  onPaquete,
  onReintentar,
}: Props) {
  const errorDeTamano = mensajeDeTamano({ tipo, dormitorios, banos });

  return (
    <div>
      {tipo === "paquete" ? (
        <fieldset className={estilos.grupo}>
          <legend className={estilos.grupoTitulo}>¿Cuántas horas necesitas?</legend>
          <div className={estilos.opciones}>
            {paquetes.map((p) => (
              <label key={p.horas} className={estilos.opcion}>
                <input type="radio" name="paquete" value={p.horas} checked={horasPaquete === p.horas} onChange={() => onPaquete(p.horas)} />
                <span className={estilos.opcionNombre}>{formatearHoras(p.horas)}</span>
                <span className={estilos.opcionDetalle}>{formatearSoles(p.precio)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <fieldset className={estilos.grupo}>
          <legend className={estilos.grupoTitulo}>Cuéntanos del tamaño de tu hogar</legend>
          <label className={estilos.campo}>
            Dormitorios
            <input
              name="dormitorios"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={dormitorios ?? ""}
              onChange={(e) => onDormitorios(leerNumero(e.target.value))}
              required
            />
          </label>
          <label className={estilos.campo}>
            Baños
            <input
              name="banos"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={banos ?? ""}
              onChange={(e) => onBanos(leerNumero(e.target.value))}
              required
            />
          </label>
          <p className={estilos.ayuda}>Todo hogar tiene una cocina. Puedes poner 0 dormitorios si es un estudio.</p>
          {errorDeTamano ? (
            <p role="alert" className={estilos.error}>
              {errorDeTamano}
            </p>
          ) : null}
        </fieldset>
      )}

      {errorDeCotizacion ? (
        <div>
          <p role="alert" className={estilos.error}>
            {errorDeCotizacion}
          </p>
          <button type="button" className={`${estilos.boton} ${estilos.botonSecundario}`} onClick={onReintentar}>
            Intentar de nuevo
          </button>
        </div>
      ) : cargando ? (
        <p className={estilos.ayuda} aria-live="polite">
          Calculando tu resumen...
        </p>
      ) : cotizacion ? (
        <ResumenCotizacion cotizacion={cotizacion} />
      ) : null}
    </div>
  );
}
