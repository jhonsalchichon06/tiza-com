import type { CreditosVista, LoteVista, MovimientoVista } from "@/lib/creditos/consulta";
import { formatearFecha, formatearFechaHora } from "@/lib/perfil/textos";
import { formatearHoras } from "@/lib/soles";
import estilos from "../cuenta.module.css";

export const TEXTO_SIN_LOTES = "Todavía no tienes crédito. Si cancelas una limpieza que ya pagaste, las horas quedan aquí para tu próxima reserva.";
export const TEXTO_SIN_MOVIMIENTOS = "Aún no hay movimientos.";

function textoDeMovimiento(m: MovimientoVista, zona: string): string {
  const limpieza = formatearFechaHora(m.reserva.inicio, zona);
  if (m.tipo === "generado") return `Crédito de ${formatearHoras(m.horas)} por la limpieza cancelada del ${limpieza}`;
  if (m.tipo === "usado") return `Usaste ${formatearHoras(m.horas)} en la limpieza del ${limpieza}`;
  return `Volvieron ${formatearHoras(m.horas)} a tu saldo: la limpieza del ${limpieza} ya no las usa`;
}

function Lote({ lote, zona }: { lote: LoteVista; zona: string }) {
  return (
    <article className={estilos.tarjeta} data-lote={lote.id} data-vigente={lote.vigente ? "si" : "no"}>
      <p className={estilos.tarjetaTitulo}>
        {formatearHoras(lote.horas_disponibles)} disponibles de {formatearHoras(lote.horas_iniciales)}
      </p>
      <p className={estilos.dato}>
        <span className={`${estilos.etiqueta} ${lote.vigente ? "" : estilos.etiquetaEspera}`}>{lote.vigente ? "Vigente" : "Vencido"}</span>{" "}
        {lote.vigente ? `Vence el ${formatearFecha(lote.vence_en, zona)}` : `Venció el ${formatearFecha(lote.vence_en, zona)}`}
      </p>
      <p className={estilos.dato}>Viene de la limpieza cancelada del {formatearFechaHora(lote.origen.inicio, zona)}.</p>
    </article>
  );
}

// Detalle del crédito en horas. Las fechas y las horas las calculó el servidor; aquí solo se escriben.
export function CreditoVista({ creditos, zona }: { creditos: CreditosVista; zona: string }) {
  return (
    <>
      <h1 className={estilos.titulo}>Mi crédito</h1>
      <p className={estilos.subtitulo}>
        {creditos.saldo_horas > 0 ? `Tienes ${formatearHoras(creditos.saldo_horas)} de crédito.` : "No tienes crédito por ahora."}
        {creditos.proximo_vencimiento ? ` Las primeras ${formatearHoras(creditos.proximo_vencimiento.horas)} vencen el ${formatearFecha(creditos.proximo_vencimiento.vence_en, zona)}.` : ""}
      </p>

      <section className={estilos.seccion} aria-label="Lotes de crédito">
        <h2 className={estilos.seccionTitulo}>Tu crédito por limpieza cancelada</h2>
        {creditos.lotes.length === 0 ? <p className={estilos.vacio}>{TEXTO_SIN_LOTES}</p> : creditos.lotes.map((l) => <Lote key={l.id} lote={l} zona={zona} />)}
      </section>

      <section className={estilos.seccion} aria-label="Movimientos">
        <h2 className={estilos.seccionTitulo}>Movimientos</h2>
        {creditos.movimientos.length === 0 ? (
          <p className={estilos.vacio}>{TEXTO_SIN_MOVIMIENTOS}</p>
        ) : (
          <ul className={estilos.movimientos}>
            {creditos.movimientos.map((m, i) => (
              <li key={`${m.tipo}-${m.reserva.id}-${i}`} className={estilos.movimiento} data-tipo={m.tipo}>
                <span>{textoDeMovimiento(m, zona)}</span> <span className={estilos.mutado}>· {formatearFecha(m.fecha, zona)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
