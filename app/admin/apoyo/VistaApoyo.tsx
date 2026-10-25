import Link from "next/link";
import type { ElementoDeApoyo } from "@/lib/admin/reservas/apoyo";
import { formatearHoras } from "@/lib/soles";
import { ESTADOS_DE_RESERVA, fechaYHora } from "../pagos/formato";
import { diasRestantesEnTexto, direccionEnTexto, horaDe } from "../reservas/formato";
import estilos from "../reservas/reservas.module.css";
import { ReprogramarReserva } from "../reservas/ReprogramarReserva";
import { AccionApoyo } from "./AccionApoyo";

// Reservas que llevan una persona de apoyo que el administrador aún no coordinó, de la más próxima a la más lejana. La
// persona de apoyo no es parte del equipo ni ocupa cupo: aquí solo se recuerda y se marca (ADR 0008).
export function VistaApoyo({ apoyo }: { apoyo: ElementoDeApoyo[] }) {
  return (
    <main className={estilos.pagina}>
      <Link href="/admin" className={estilos.volver}>
        ← Portal de administración
      </Link>
      <h1 className={estilos.titulo}>Apoyo por coordinar</h1>
      <p className={estilos.ayuda}>Hogares grandes: consigue a la persona de apoyo por tu cuenta y márcala como coordinada.</p>
      {apoyo.length === 0 ? (
        <p className={estilos.vacio}>No hay apoyo por coordinar</p>
      ) : (
        <ul className={estilos.lista}>
          {apoyo.map((a) => (
            <li key={a.id} className={estilos.tarjeta}>
              <div className={estilos.cabecera}>
                <span className={estilos.cliente}>{a.cliente.nombre}</span>
                <span className={estilos.apoyo}>{diasRestantesEnTexto(a.dias_restantes)}</span>
              </div>
              <span className={estilos.detalle}>
                {fechaYHora(a.inicio)} a {horaDe(a.fin)} · {ESTADOS_DE_RESERVA[a.estado] ?? a.estado}
              </span>
              <span className={estilos.detalle}>{direccionEnTexto(a.direccion)}</span>
              <span className={estilos.detalle}>
                Trabajo de {formatearHoras(a.horas_trabajo)} · en la agenda {formatearHoras(a.horas_agenda)}
              </span>
              {a.apoyo_nota ? <p className={estilos.nota}>Nota: {a.apoyo_nota}</p> : null}
              <AccionApoyo reservaId={a.id} notaInicial={a.apoyo_nota} />
              {a.puede_reprogramar ? <ReprogramarReserva reservaId={a.id} celular={a.cliente.celular} requiereApoyo /> : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
