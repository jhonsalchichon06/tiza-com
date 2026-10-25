import Link from "next/link";
import type { RespuestaListado } from "@/lib/admin/reservas/listado";
import { ESTADOS_DE_RESERVA, fechaYHora } from "../pagos/formato";
import { AccionesReserva } from "./AccionesReserva";
import { direccionEnTexto, horaDe, servicioEnTexto } from "./formato";
import { ReprogramarReserva } from "./ReprogramarReserva";
import estilos from "./reservas.module.css";

export const FILTROS: { valor: string | null; texto: string }[] = [
  { valor: null, texto: "Próximas" },
  { valor: "pendiente", texto: "En espera" },
  { valor: "confirmada", texto: "Confirmadas" },
  { valor: "por_completar", texto: "Por completar" },
  { valor: "completada", texto: "Completadas" },
  { valor: "cancelada", texto: "Canceladas" },
  { valor: "expirada", texto: "Expiradas" },
];

const CLASE_DE_ESTADO: Record<string, string> = {
  expirada: estilos.estadoExpirada,
  cancelada: estilos.estadoCancelada,
  pendiente: estilos.estadoPendiente,
};

// Lista de reservas del portal: cliente, servicio, dirección, fecha y hora de Lima, equipo y estado efectivo (una espera
// vencida se ve «Expirada»). Los botones aparecen según los indicadores `puede_*` que calculó el servidor.
export function VistaReservas({ datos, filtro }: { datos: RespuestaListado; filtro: string | null }) {
  return (
    <main className={estilos.pagina}>
      <Link href="/admin" className={estilos.volver}>
        ← Portal de administración
      </Link>
      <h1 className={estilos.titulo}>Reservas</h1>
      <p className={estilos.ayuda}>Marca como completada cada limpieza realizada o cambia una reserva de equipo.</p>
      <ul className={estilos.filtros} aria-label="Filtrar por estado">
        {FILTROS.map((f) => (
          <li key={f.texto}>
            <Link
              href={f.valor ? `/admin/reservas?estado=${f.valor}` : "/admin/reservas"}
              className={`${estilos.filtro} ${f.valor === filtro ? estilos.filtroActivo : ""}`}
              aria-current={f.valor === filtro ? "page" : undefined}
            >
              {f.texto}
            </Link>
          </li>
        ))}
      </ul>
      {datos.reservas.length === 0 ? (
        <p className={estilos.vacio}>No hay reservas para mostrar</p>
      ) : (
        <ul className={estilos.lista}>
          {datos.reservas.map((r) => (
            <li key={r.id} className={estilos.tarjeta}>
              <div className={estilos.cabecera}>
                <span className={estilos.cliente}>{r.cliente.nombre}</span>
                <span className={`${estilos.estado} ${CLASE_DE_ESTADO[r.estado] ?? ""}`}>{ESTADOS_DE_RESERVA[r.estado] ?? r.estado}</span>
              </div>
              <span className={estilos.detalle}>{servicioEnTexto(r.servicio)}</span>
              <span className={estilos.detalle}>{direccionEnTexto(r.direccion)}</span>
              <span className={estilos.detalle}>
                {fechaYHora(r.inicio)} a {horaDe(r.fin)} · {r.equipo.nombre}
              </span>
              {r.requiere_apoyo ? (
                <span>
                  <span className={estilos.apoyo}>Requiere apoyo · {r.apoyo_estado === "coordinado" ? "coordinado" : "por coordinar"}</span>
                </span>
              ) : null}
              <span className={estilos.detalle}>
                <Link href={`/admin/pagos/${r.pago_id}`} className={estilos.enlace}>
                  Ver pago
                </Link>
                {r.estado === "completada" ? (
                  <>
                    {" · "}
                    <Link href={`/admin/reservas/${r.id}/fotos`} className={estilos.enlace}>
                      Fotos
                    </Link>
                  </>
                ) : null}
              </span>
              <AccionesReserva
                reservaId={r.id}
                puedeCompletar={r.puede_completar}
                puedeReasignar={r.puede_reasignar}
                equipoActualId={r.equipo.id}
                equipos={datos.equipos}
              />
              {r.puede_reprogramar ? <ReprogramarReserva reservaId={r.id} celular={r.cliente.celular} requiereApoyo={r.requiere_apoyo} /> : null}
              {r.reprogramada_en ? (
                <span className={estilos.detalle}>
                  Reprogramada por {r.reprogramada_por?.nombre ?? "un administrador"} el {fechaYHora(r.reprogramada_en)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
