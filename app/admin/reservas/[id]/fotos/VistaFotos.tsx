import Link from "next/link";
import { agruparPorAmbiente } from "@/lib/fotos/listar";
import type { DatosPantallaFotos } from "@/lib/fotos/pantalla";
import { ESTADOS_DE_RESERVA, fechaYHora } from "../../../pagos/formato";
import { direccionEnTexto, servicioEnTexto } from "../../formato";
import estilos from "./fotos.module.css";
import { SubirFotos } from "./SubirFotos";

export const TEXTO_NO_COMPLETADA = "Solo puedes subir fotos de una limpieza completada.";
export const TEXTO_SIN_FOTOS = "Aún no hay fotos";
export const TEXTO_LIMITE_ALCANZADO = (limite: number) => `Esta reserva ya llegó al máximo de ${limite} fotos.`;

// Pantalla del administrador para las fotos de una reserva. Presentación pura (se prueba con `renderToStaticMarkup`). Las
// imágenes se piden a `/api/fotos/<id>`, que decide el permiso: aquí nunca hay una URL de Blob.
export function VistaFotos({ datos }: { datos: DatosPantallaFotos }) {
  const { reserva, limite, fotos } = datos;
  const completada = reserva.estado === "completada";
  const caben = Math.max(0, limite - fotos.length);
  const grupos = agruparPorAmbiente(fotos);

  return (
    <main className={estilos.pagina}>
      <Link href="/admin/reservas" className={estilos.volver}>
        ← Reservas
      </Link>
      <h1 className={estilos.titulo}>Fotos del servicio</h1>
      <div className={estilos.resumen}>
        <span>Cliente: {reserva.cliente}</span>
        <span>{servicioEnTexto(reserva.servicio)}</span>
        <span>{direccionEnTexto(reserva.direccion)}</span>
        <span>
          {fechaYHora(reserva.inicio)} · {ESTADOS_DE_RESERVA[reserva.estado] ?? reserva.estado}
        </span>
      </div>

      {!completada ? (
        <p className={estilos.aviso} role="note">
          {TEXTO_NO_COMPLETADA}
        </p>
      ) : (
        <>
          <section className={estilos.seccion} aria-label="Fotos subidas">
            <h2 className={estilos.seccionTitulo}>
              Fotos subidas ({fotos.length} de {limite})
            </h2>
            {grupos.length === 0 ? (
              <p className={estilos.vacio}>{TEXTO_SIN_FOTOS}</p>
            ) : (
              grupos.map((g) => (
                <div key={g.ambiente} className={estilos.grupo}>
                  <h3 className={estilos.grupoTitulo}>{g.etiqueta}</h3>
                  <ul className={estilos.galeria}>
                    {g.fotos.map((f) => (
                      <li key={f.id}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className={estilos.foto} src={`/api/fotos/${f.id}`} alt={g.etiqueta} loading="lazy" />
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>

          <section className={estilos.seccion} aria-label="Subir fotos">
            <h2 className={estilos.seccionTitulo}>Subir fotos</h2>
            {caben === 0 ? <p className={estilos.aviso}>{TEXTO_LIMITE_ALCANZADO(limite)}</p> : <SubirFotos reservaId={reserva.id} caben={caben} />}
          </section>
        </>
      )}
    </main>
  );
}
