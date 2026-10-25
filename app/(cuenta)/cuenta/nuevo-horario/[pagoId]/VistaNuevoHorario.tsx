import Link from "next/link";
import { describirDia } from "@/lib/reservas/asistente/dias";
import type { HorarioElegido } from "@/lib/reservas/asistente/estado";
import { NOMBRES_DE_SERVICIO } from "@/lib/reservas/asistente/nombres";
import type { RespuestaNuevoHorario } from "@/lib/reservas/nuevo-horario";
import type { DatosNuevoHorario } from "@/lib/reservas/nuevo-horario-datos";
import { formatearHoras } from "@/lib/soles";
import { PasoFecha, TEXTO_LIMITE_MIEMBRO, type DisponibilidadDelDia } from "../../../../reservar/PasoFecha";
import estilos from "../../../../reservar/reservar.module.css";

// Pantalla para elegir el nuevo día y hora de un pago ya aprobado (reservar-como-miembro-activo). Presentacional: no tiene
// estado ni llama a la red; `ElegirNuevoHorario` le pasa lo que el servidor devolvió. Sin cifras escritas a mano.

export const TEXTO_YA_PAGASTE = "Ya pagaste esta limpieza: no tienes que pagar otra vez.";

type Props = {
  datos: DatosNuevoHorario;
  dias: string[];
  dia: string | null;
  horario: HorarioElegido | null;
  disponibilidad: DisponibilidadDelDia;
  mensaje: string | null;
  enviando: boolean;
  // Verdadero cuando el servidor dijo que las horas pasan a crédito: no se ofrece reintentar.
  enCredito?: boolean;
  resultado: RespuestaNuevoHorario | null;
  onDia: (dia: string) => void;
  onHorario: (horario: HorarioElegido) => void;
  onReintentarHorarios: () => void;
  onConfirmar: () => void;
};

const diaDe = (iso: string) => describirDia(iso.slice(0, 10));
const horaDe = (iso: string) => iso.slice(11, 16);

export function nombreDelServicio(servicio: DatosNuevoHorario["servicio"]): string {
  return servicio.tipo === "paquete" ? `Paquete de ${formatearHoras(servicio.horas)}` : NOMBRES_DE_SERVICIO[servicio.tipo];
}

export function lineaDeDireccion(d: DatosNuevoHorario["direccion"]): string {
  return [`${d.calle} ${d.numero}`, d.departamento?.trim(), d.distrito].filter(Boolean).join(", ");
}

export function VistaNuevoHorario(p: Props) {
  if (p.resultado) {
    const { reserva, whatsapp } = p.resultado;
    return (
      <div role="status">
        <h1 className={estilos.titulo}>¡Tu limpieza está confirmada!</h1>
        <p className={estilos.subtitulo}>Usamos tu pago ya aprobado: no tuviste que subir otro comprobante.</p>
        <dl className={estilos.resumen} aria-label="Resumen de tu reserva">
          <div className={estilos.resumenFila}>
            <dt>Servicio</dt>
            <dd>{nombreDelServicio(reserva.servicio)}</dd>
          </div>
          <div className={estilos.resumenFila}>
            <dt>Día y hora</dt>
            <dd>
              {diaDe(reserva.inicio)}, {horaDe(reserva.inicio)}
            </dd>
          </div>
          <div className={estilos.resumenFila}>
            <dt>Dirección</dt>
            <dd>{lineaDeDireccion(p.datos.direccion)}</dd>
          </div>
        </dl>
        <div className={estilos.acciones}>
          {whatsapp ? (
            <a className={`${estilos.boton} ${estilos.botonWhatsapp}`} href={whatsapp} target="_blank" rel="noopener noreferrer">
              Coordinar por WhatsApp
            </a>
          ) : null}
          <Link className={`${estilos.boton} ${estilos.botonSecundario}`} href="/cuenta">
            Ir a mi cuenta
          </Link>
        </div>
      </div>
    );
  }

  const bloqueado = p.enCredito === true;
  return (
    <div>
      <h1 className={estilos.titulo}>Elige tu nuevo día y hora</h1>
      <dl className={estilos.resumen} aria-label="Tu limpieza">
        <div className={estilos.resumenFila}>
          <dt>Servicio</dt>
          <dd>{nombreDelServicio(p.datos.servicio)}</dd>
        </div>
        <div className={estilos.resumenFila}>
          <dt>Duración del servicio</dt>
          <dd>{formatearHoras(p.datos.horas_trabajo)}</dd>
        </div>
        <div className={estilos.resumenFila}>
          <dt>Dirección</dt>
          <dd>{lineaDeDireccion(p.datos.direccion)}</dd>
        </div>
      </dl>
      <p className={estilos.exito}>{TEXTO_YA_PAGASTE}</p>

      {bloqueado ? (
        <div>
          <p role="alert" className={estilos.error}>
            {p.mensaje}
          </p>
          <div className={estilos.acciones}>
            <Link className={estilos.boton} href="/cuenta">
              Ir a mi cuenta
            </Link>
          </div>
        </div>
      ) : (
        <>
          <PasoFecha
            dias={p.dias}
            limite={p.datos.limite}
            textoLimite={TEXTO_LIMITE_MIEMBRO}
            dia={p.dia}
            horario={p.horario}
            disponibilidad={p.disponibilidad}
            mensaje={p.mensaje}
            onDia={p.onDia}
            onHorario={p.onHorario}
            onReintentar={p.onReintentarHorarios}
          />
          <div className={estilos.acciones}>
            <button type="button" className={estilos.boton} disabled={p.horario === null || p.enviando} onClick={p.onConfirmar}>
              {p.enviando ? "Enviando..." : "Confirmar mi nuevo horario"}
            </button>
            <Link className={`${estilos.boton} ${estilos.botonSecundario}`} href="/cuenta">
              Volver a mi cuenta
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
