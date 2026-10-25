import type { Horario } from "@/lib/agenda/disponibilidad";
import { describirDia, horarioPermitido, nombreDelDia, nombreDelMes, numeroDelDia } from "@/lib/reservas/asistente/dias";
import type { HorarioElegido } from "@/lib/reservas/asistente/estado";
import estilos from "./reservar.module.css";

export type DisponibilidadDelDia =
  | { estado: "sin_elegir" }
  | { estado: "cargando" }
  | { estado: "error"; mensaje: string }
  | { estado: "listo"; atendido: boolean; horarios: Horario[] };

type Props = {
  dias: string[]; // fechas AAAA-MM-DD sin domingos, de la cotización
  limite: string; // instante desde el que ya no se reserva (primera membresía o fin de la membresía)
  // Por qué un horario pasa el límite; cambia según el modo (primera membresía o miembro).
  textoLimite?: string;
  dia: string | null;
  horario: HorarioElegido | null;
  disponibilidad: DisponibilidadDelDia;
  mensaje: string | null; // p. ej. el 409 de "elige otra hora"
  onDia: (dia: string) => void;
  onHorario: (horario: HorarioElegido) => void;
  onReintentar: () => void;
};

const MOTIVOS: Record<string, string> = {
  sin_cupo: "sin cupo",
  anticipacion: "no alcanza la anticipación",
};

export const TEXTO_LIMITE_PRIMERA = "fuera del plazo de tu primera membresía";
export const TEXTO_LIMITE_MIEMBRO = "fuera de la vigencia de tu membresía";

export function PasoFecha({ dias, limite, textoLimite = TEXTO_LIMITE_PRIMERA, dia, horario, disponibilidad, mensaje, onDia, onHorario, onReintentar }: Props) {
  // Los días se agrupan por mes para que el calendario sea fácil de recorrer.
  const meses: { titulo: string; dias: string[] }[] = [];
  for (const d of dias) {
    const titulo = nombreDelMes(d);
    const ultimo = meses[meses.length - 1];
    if (ultimo && ultimo.titulo === titulo) ultimo.dias.push(d);
    else meses.push({ titulo, dias: [d] });
  }

  return (
    <div>
      {mensaje ? (
        <p role="alert" className={estilos.aviso409}>
          {mensaje}
        </p>
      ) : null}

      {dias.length === 0 ? (
        <p className={estilos.ayuda}>
          No quedan días disponibles dentro de la vigencia de tu membresía. Renueva tu membresía desde tu cuenta para seguir reservando.
        </p>
      ) : null}

      <fieldset className={estilos.grupo}>
        <legend className={estilos.grupoTitulo}>Elige el día (de lunes a sábado)</legend>
        {meses.map((mes) => (
          <div key={mes.titulo}>
            <p className={estilos.mes}>{mes.titulo}</p>
            <div className={estilos.dias}>
              {mes.dias.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={estilos.dia}
                  aria-pressed={dia === d}
                  aria-label={describirDia(d)}
                  onClick={() => onDia(d)}
                >
                  <span className={estilos.diaSemana}>{nombreDelDia(d).slice(0, 3)}</span>
                  <span className={estilos.diaNumero}>{numeroDelDia(d)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </fieldset>

      {dia ? (
        <fieldset className={estilos.grupo}>
          <legend className={estilos.grupoTitulo}>Elige la hora de llegada el {describirDia(dia)}</legend>
          {disponibilidad.estado === "cargando" ? (
            <p className={estilos.ayuda} aria-live="polite">
              Buscando horarios...
            </p>
          ) : disponibilidad.estado === "error" ? (
            <div>
              <p role="alert" className={estilos.error}>
                {disponibilidad.mensaje}
              </p>
              <button type="button" className={`${estilos.boton} ${estilos.botonSecundario}`} onClick={onReintentar}>
                Intentar de nuevo
              </button>
            </div>
          ) : disponibilidad.estado === "listo" ? (
            disponibilidad.horarios.length === 0 ? (
              <p className={estilos.ayuda}>Ese día no hay atención. Elige otro día.</p>
            ) : (
              <div className={estilos.horas}>
                {disponibilidad.horarios.map((h) => {
                  const pasaElLimite = !horarioPermitido(h.inicio, limite);
                  const libre = h.disponible && !pasaElLimite;
                  const motivo = pasaElLimite ? textoLimite : h.motivo ? MOTIVOS[h.motivo] : "no disponible";
                  const elegido = horario?.inicio === h.inicio;
                  return (
                    <button
                      key={h.inicio}
                      type="button"
                      className={libre ? estilos.hora : `${estilos.hora} ${estilos.horaNoDisponible}`}
                      disabled={!libre}
                      aria-pressed={libre ? elegido : undefined}
                      aria-label={libre ? h.hora : `${h.hora}, ${motivo}`}
                      onClick={() => onHorario({ hora: h.hora, inicio: h.inicio })}
                    >
                      {h.hora}
                    </button>
                  );
                })}
              </div>
            )
          ) : null}
          <p className={estilos.ayuda}>Los horarios en gris no están disponibles. Todas las horas son de Lima.</p>
        </fieldset>
      ) : null}
    </div>
  );
}
