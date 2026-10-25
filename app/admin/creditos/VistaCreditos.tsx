import Link from "next/link";
import type { ClienteConCredito, DetalleAdmin } from "@/lib/creditos/consulta";
import { formatearFecha, formatearFechaHora } from "@/lib/perfil/textos";
import { formatearHoras } from "@/lib/soles";
import estilos from "./creditos.module.css";

// Crédito en horas de cada cliente para el administrador (ADR 0012). SOLO LECTURA: en v1 el administrador no crea, edita ni
// mueve créditos a mano, así que ninguna de estas vistas tiene botones ni formularios.

export const TEXTO_SIN_CLIENTES = "Ningún cliente tiene crédito en horas.";

export function VistaCreditos({ clientes, zona }: { clientes: ClienteConCredito[]; zona: string }) {
  return (
    <main className={estilos.pagina}>
      <Link href="/admin" className={estilos.volver}>
        ← Portal de administración
      </Link>
      <h1 className={estilos.titulo}>Crédito en horas</h1>
      <p className={estilos.ayuda}>Clientes que tienen o tuvieron crédito por cancelar una limpieza pagada, el que vence antes primero.</p>
      {clientes.length === 0 ? (
        <p className={estilos.vacio}>{TEXTO_SIN_CLIENTES}</p>
      ) : (
        <ul className={estilos.lista}>
          {clientes.map((c) => (
            <li key={c.usuario_id} className={estilos.tarjeta}>
              <Link className={estilos.cliente} href={`/admin/creditos/${encodeURIComponent(c.usuario_id)}`}>
                {c.nombre}
              </Link>
              <span className={estilos.detalle}>{c.correo}</span>
              <span>
                {c.saldo_horas > 0 ? `Saldo vigente: ${formatearHoras(c.saldo_horas)}` : "Sin crédito vigente"}
                {c.proximo_vencimiento ? ` · vence el ${formatearFecha(c.proximo_vencimiento, zona)}` : ""}
              </span>
              <span className={estilos.detalle}>{c.lotes === 1 ? "1 lote" : `${c.lotes} lotes`}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const TIPOS = { generado: "Generado", usado: "Usado", devuelto: "Devuelto" } as const;

export function VistaCreditosDeCliente({ detalle, zona }: { detalle: DetalleAdmin; zona: string }) {
  const { cliente } = detalle;
  return (
    <main className={estilos.pagina}>
      <Link href="/admin/creditos" className={estilos.volver}>
        ← Crédito en horas
      </Link>
      <h1 className={estilos.titulo}>Crédito de {cliente.nombre}</h1>
      <p className={estilos.ayuda}>
        {cliente.correo} · {detalle.saldo_horas > 0 ? `Saldo vigente: ${formatearHoras(detalle.saldo_horas)}` : "Sin crédito vigente"}
        {detalle.proximo_vencimiento ? ` · ${formatearHoras(detalle.proximo_vencimiento.horas)} vencen el ${formatearFecha(detalle.proximo_vencimiento.vence_en, zona)}` : ""}
      </p>

      <section className={estilos.seccion} aria-label="Lotes">
        <h2 className={estilos.seccionTitulo}>Lotes</h2>
        {detalle.lotes.length === 0 ? (
          <p className={estilos.vacio}>Este cliente no tiene lotes de crédito.</p>
        ) : (
          <ul className={estilos.lista}>
            {detalle.lotes.map((l) => (
              <li key={l.id} className={estilos.tarjeta}>
                <span>
                  {formatearHoras(l.horas_disponibles)} disponibles de {formatearHoras(l.horas_iniciales)}{" "}
                  <span className={`${estilos.etiqueta} ${l.vigente ? "" : estilos.vencido}`}>{l.vigente ? "Vigente" : "Vencido"}</span>
                </span>
                <span className={estilos.detalle}>
                  {l.vigente ? "Vence" : "Venció"} el {formatearFecha(l.vence_en, zona)} · viene de la limpieza cancelada del {formatearFechaHora(l.origen.inicio, zona)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={estilos.seccion} aria-label="Movimientos">
        <h2 className={estilos.seccionTitulo}>Movimientos</h2>
        {detalle.movimientos.length === 0 ? (
          <p className={estilos.vacio}>Aún no hay movimientos.</p>
        ) : (
          <ul className={estilos.lista}>
            {detalle.movimientos.map((m, i) => (
              <li key={`${m.tipo}-${m.reserva.id}-${i}`} className={estilos.tarjeta}>
                <span>
                  {TIPOS[m.tipo]}: {formatearHoras(m.horas)} · limpieza del {formatearFechaHora(m.reserva.inicio, zona)}
                </span>
                <span className={estilos.detalle}>{formatearFechaHora(m.fecha, zona)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
