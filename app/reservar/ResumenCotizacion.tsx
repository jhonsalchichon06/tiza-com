import type { Cotizacion, CotizacionMiembro } from "@/lib/reservas/cotizar";
import { mensajeCreditoCubre, mensajeCreditoParcial } from "@/lib/creditos/textos";
import { textoSinGratis } from "@/lib/reservas/asistente/sin-gratis";
import { formatearHoras, formatearSoles } from "@/lib/soles";
import estilos from "./reservar.module.css";

// Muestra lo que calculó el servidor (GET /api/cotizacion); el navegador no suma ni multiplica nada.
// Aviso cuando las 3 horas gratis no aplican (el servidor dice por qué).
export function AvisoSinGratis({ cotizacion }: { cotizacion: Cotizacion }) {
  // Un miembro que ya tuvo su limpieza gratis es el caso normal: no se le avisa. Solo se avisa si fue el hogar.
  if (cotizacion.modo === "miembro" && cotizacion.motivo_sin_gratis === "cliente") return null;
  const texto = textoSinGratis(cotizacion.motivo_sin_gratis);
  return texto ? <p className={estilos.nota}>{texto}</p> : null;
}

// Crédito en horas de un miembro (ítem 14): «Tu crédito de N horas cubre esta limpieza.» si no queda nada por pagar y
// «Usaremos N horas de tu crédito.» si cubre solo una parte. Las horas las calculó el servidor.
export function AvisoDeCredito({ cotizacion }: { cotizacion: Cotizacion }) {
  if (cotizacion.modo !== "miembro" || cotizacion.credito_aplicado <= 0) return null;
  const horas = cotizacion.credito_aplicado;
  return <p className={estilos.nota}>{cotizacion.cubierta_por_credito ? mensajeCreditoCubre({ horas }) : mensajeCreditoParcial({ horas })}</p>;
}

export function ResumenCotizacion({ cotizacion }: { cotizacion: Cotizacion }) {
  if (cotizacion.modo === "miembro") return <ResumenDeMiembro cotizacion={cotizacion} />;
  return (
    <div>
      <dl className={estilos.resumen} aria-label="Resumen de tu servicio">
        <div className={estilos.resumenFila}>
          <dt>Duración del servicio</dt>
          <dd>{formatearHoras(cotizacion.horas_trabajo)}</dd>
        </div>
        <div className={estilos.resumenFila}>
          <dt>Precio de lista</dt>
          <dd>{formatearSoles(cotizacion.precio_lista)}</dd>
        </div>
        {cotizacion.aplica_gratis ? (
          <div className={estilos.resumenFila}>
            <dt>Gratis por ser tu primera limpieza</dt>
            <dd>{formatearHoras(cotizacion.horas_gratis_aplicadas)}</dd>
          </div>
        ) : null}
        {cotizacion.horas_cobrar > 0 ? (
          <div className={estilos.resumenFila}>
            <dt>
              {cotizacion.aplica_gratis ? "Horas adicionales" : "Horas a pagar"} ({formatearHoras(cotizacion.horas_cobrar)}, con tu descuento de miembro)
            </dt>
            <dd>{formatearSoles(cotizacion.monto)}</dd>
          </div>
        ) : (
          <div className={estilos.resumenFila}>
            <dt>Horas adicionales</dt>
            <dd>Ninguna</dd>
          </div>
        )}
      </dl>
      <AvisoSinGratis cotizacion={cotizacion} />
      {cotizacion.requiere_apoyo ? (
        <p className={estilos.nota}>
          Tu hogar es grande, así que coordinamos una persona de apoyo para terminar a tiempo. El precio no cambia.
        </p>
      ) : null}
    </div>
  );
}

// Resumen de un miembro activo: precio de lista, lo gratis o el crédito, el descuento de miembro y el total. Todas las cifras
// son las del servidor; aquí no se calcula ni se escribe ningún porcentaje.
function ResumenDeMiembro({ cotizacion }: { cotizacion: CotizacionMiembro }) {
  const cobra = cotizacion.horas_cobrar > 0;
  return (
    <div>
      <AvisoDeCredito cotizacion={cotizacion} />
      <dl className={estilos.resumen} aria-label="Resumen de tu servicio">
        <div className={estilos.resumenFila}>
          <dt>Duración del servicio</dt>
          <dd>{formatearHoras(cotizacion.horas_trabajo)}</dd>
        </div>
        <div className={estilos.resumenFila}>
          <dt>Precio de lista</dt>
          <dd>{formatearSoles(cotizacion.precio_lista)}</dd>
        </div>
        {cotizacion.aplica_gratis ? (
          <div className={estilos.resumenFila}>
            <dt>Gratis por ser tu primera limpieza</dt>
            <dd>{formatearHoras(cotizacion.horas_gratis_aplicadas)}</dd>
          </div>
        ) : null}
        {cotizacion.credito_aplicado > 0 ? (
          <div className={estilos.resumenFila}>
            <dt>Crédito en horas</dt>
            <dd>{formatearHoras(cotizacion.credito_aplicado)}</dd>
          </div>
        ) : null}
        {cobra ? (
          <>
            <div className={estilos.resumenFila}>
              <dt>{cotizacion.aplica_gratis || cotizacion.credito_aplicado > 0 ? "Horas adicionales" : "Horas a pagar"} ({formatearHoras(cotizacion.horas_cobrar)})</dt>
              <dd>{formatearSoles(cotizacion.subtotal)}</dd>
            </div>
            {cotizacion.descuento > 0 ? (
              <div className={estilos.resumenFila}>
                <dt>Descuento de miembro</dt>
                <dd>-{formatearSoles(cotizacion.descuento)}</dd>
              </div>
            ) : null}
            <div className={`${estilos.resumenFila} ${estilos.resumenTotal}`}>
              <dt>Total a pagar</dt>
              <dd>{formatearSoles(cotizacion.total_a_pagar)}</dd>
            </div>
          </>
        ) : (
          <div className={`${estilos.resumenFila} ${estilos.resumenTotal}`}>
            <dt>Esta limpieza no tiene costo</dt>
            <dd>{formatearSoles(0)}</dd>
          </div>
        )}
      </dl>
      <AvisoSinGratis cotizacion={cotizacion} />
      {cotizacion.requiere_apoyo ? (
        <p className={estilos.nota}>
          Tu hogar es grande, así que coordinamos una persona de apoyo para terminar a tiempo. El precio no cambia.
        </p>
      ) : null}
    </div>
  );
}
