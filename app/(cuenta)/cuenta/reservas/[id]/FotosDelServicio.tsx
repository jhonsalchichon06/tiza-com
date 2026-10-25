import { agruparPorAmbiente, type FotoVista } from "@/lib/fotos/listar";
import estilos from "../../cuenta.module.css";

export const TEXTO_SIN_FOTOS_DEL_SERVICIO = "Aún no hay fotos de este servicio";

// Fotos del servicio en el detalle de la reserva (ítem 17), agrupadas por ambiente. Componente de servidor. Solo una limpieza
// completada puede tener fotos: en cualquier otro estado no muestra nada. Las imágenes se piden a `/api/fotos/<id>` con la
// cookie del cliente (esa ruta responde 404 a quien no es el dueño); no se usa `next/image` porque el optimizador no podría
// pedirlas con la sesión. Nunca hay una ruta ni una URL de Blob en el HTML.
export function FotosDelServicio({ estado, fotos }: { estado: string; fotos: FotoVista[] }) {
  if (estado !== "completada") return null;
  const grupos = agruparPorAmbiente(fotos);
  return (
    <section className={estilos.tarjeta} aria-label="Fotos del servicio">
      <p className={estilos.tarjetaTitulo}>Fotos del servicio</p>
      {grupos.length === 0 ? (
        <p className={estilos.vacio}>{TEXTO_SIN_FOTOS_DEL_SERVICIO}</p>
      ) : (
        grupos.map((g) => (
          <div key={g.ambiente}>
            <p className={estilos.dato}>
              <strong>{g.etiqueta}</strong>
            </p>
            <div className={estilos.fotos}>
              {g.fotos.map((f) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={f.id} className={estilos.foto} src={`/api/fotos/${f.id}`} alt={g.etiqueta} loading="lazy" />
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
