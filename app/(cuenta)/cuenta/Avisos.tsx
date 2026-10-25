import type { Aviso } from "@/lib/perfil/avisos";
import { formatearFechaHora } from "@/lib/perfil/textos";
import estilos from "./cuenta.module.css";
import { ReenviarComprobante } from "./ReenviarComprobante";

// A dónde lleva «Elige un nuevo día y hora»: la pantalla que usa el mismo pago, sin otro comprobante (reservar-como-miembro-activo).
export const rutaDelNuevoHorario = (pagoId: string) => `/cuenta/nuevo-horario/${encodeURIComponent(pagoId)}`;

// Avisos del perfil (códigos estables del servidor). Para un comprobante rechazado dentro del plazo se muestra el formulario
// de reenvío; el servidor decide qué pagos son reenviables (`pagosRechazadosReenviables`), aquí no se recalcula nada.
export function Avisos({ avisos, usuarioId, zona }: { avisos: Aviso[]; usuarioId: string; zona: string }) {
  if (avisos.length === 0) return null;
  return (
    <section aria-label="Avisos">
      {avisos.map((aviso, i) => {
        const atencion = aviso.codigo === "pago_rechazado" || aviso.codigo === "plazo_vencido" || aviso.codigo === "vencida";
        return (
          <div key={`${aviso.codigo}-${aviso.pago_id ?? i}`} role="status" className={`${estilos.aviso} ${atencion ? estilos.avisoAtencion : ""}`} data-aviso={aviso.codigo}>
            <p className={estilos.avisoTexto}>{aviso.texto}</p>
            {aviso.motivo ? <p className={estilos.avisoMotivo}>Motivo: {aviso.motivo}</p> : null}
            {aviso.codigo === "pago_rechazado" && aviso.pago_id ? (
              <ReenviarComprobante pagoId={aviso.pago_id} usuarioId={usuarioId} esperaHasta={aviso.reserva_expira_en ? formatearFechaHora(aviso.reserva_expira_en, zona) : null} />
            ) : null}
            {aviso.codigo === "nuevo_horario" && aviso.pago_id ? (
              <div className={estilos.acciones}>
                <a className={estilos.boton} href={rutaDelNuevoHorario(aviso.pago_id)}>
                  Elegir mi nuevo día y hora
                </a>
              </div>
            ) : null}
            {aviso.enlace ? (
              <div className={estilos.acciones}>
                <a className={estilos.boton} href={aviso.enlace.href}>
                  {aviso.enlace.texto}
                </a>
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
