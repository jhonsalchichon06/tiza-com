import { puedeElegirDiaYHora, type Renovacion } from "@/lib/membresia/renovacion";
import type { MembresiaDelPerfil } from "@/lib/perfil/membresia";
import type { ProximaVista, ReservaVista, ServicioVista } from "@/lib/perfil/reservas";
import type { RespuestaPerfil } from "@/lib/perfil/resumen";
import { formatearFecha, formatearFechaHora } from "@/lib/perfil/textos";
import { describirServicio } from "@/lib/reservas/whatsapp";
import { formatearHoras, formatearSoles } from "@/lib/soles";
import { AvisoRenovacion } from "./AvisoRenovacion";
import { Avisos } from "./Avisos";
import estilos from "./cuenta.module.css";

type Usuario = { id: string; nombre: string; correo: string; celular: string };

export const textoDeServicio = (s: ServicioVista) => describirServicio(s.tipo === "paquete" ? { tipo: "paquete", horas: s.horas } : { tipo: s.tipo });

export const textoDeDireccion = (d: ReservaVista["direccion"]) => [`${d.calle} ${d.numero}`, d.departamento ? `Dpto. ${d.departamento}` : null, d.distrito].filter(Boolean).join(", ");

export function TarjetaMembresia({ membresia, zona, renovacion = { estado: "no_aplica" } }: { membresia: MembresiaDelPerfil; zona: string; renovacion?: Renovacion }) {
  return (
    <section className={estilos.seccion} aria-label="Mi membresía">
      <h2 className={estilos.seccionTitulo}>Mi membresía</h2>
      <div className={estilos.tarjeta}>
        {membresia.estado === "activa" ? (
          <>
            <p className={estilos.tarjetaTitulo}>Tu membresía está activa hasta el {formatearFecha(membresia.fin, zona)}</p>
            <p className={estilos.dato}>
              Te {membresia.dias_restantes === 1 ? "queda 1 día" : `quedan ${membresia.dias_restantes} días`}. Empezó el {formatearFecha(membresia.inicio, zona)}.
            </p>
            {puedeElegirDiaYHora(membresia, renovacion) ? (
              <div className={estilos.acciones}>
                <a className={estilos.boton} href="/reservar">
                  Elegir día y hora
                </a>
              </div>
            ) : null}
          </>
        ) : membresia.estado === "vencida" ? (
          <p className={estilos.tarjetaTitulo}>Tu membresía venció el {formatearFecha(membresia.fin, zona)}</p>
        ) : membresia.estado === "en_revision" ? (
          <p className={estilos.tarjetaTitulo}>Tu membresía está en revisión</p>
        ) : membresia.estado === "pago_rechazado" ? (
          <p className={estilos.tarjetaTitulo}>Tu comprobante fue rechazado</p>
        ) : (
          <>
            <p className={estilos.tarjetaTitulo}>Aún no eres miembro de Tiza Club</p>
            <div className={estilos.acciones}>
              <a className={estilos.boton} href="/reservar">
                Reservar mi primera limpieza
              </a>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// `totalFotos` (ítem 17): solo un número con el enlace al detalle; el historial no carga imágenes.
function ResumenDeReserva({ reserva, zona, etiquetaEspera, dejarResena, totalFotos = 0 }: { reserva: ReservaVista; zona: string; etiquetaEspera?: boolean; dejarResena?: boolean; totalFotos?: number }) {
  return (
    <article className={estilos.tarjeta} data-reserva={reserva.id}>
      <p className={estilos.tarjetaTitulo}>{formatearFechaHora(reserva.inicio, zona)}</p>
      <p className={estilos.dato}>{textoDeServicio(reserva.servicio)}</p>
      <p className={estilos.dato}>{textoDeDireccion(reserva.direccion)}</p>
      <p className={estilos.dato}>
        <span className={`${estilos.etiqueta} ${etiquetaEspera ? estilos.etiquetaEspera : ""}`}>{reserva.estado_texto}</span>
        {reserva.expira_en ? <span className={estilos.mutado}> · hasta el {formatearFechaHora(reserva.expira_en, zona)}</span> : null}
      </p>
      <p className={estilos.dato}>{reserva.monto > 0 ? `Total: ${formatearSoles(reserva.monto)}` : "Sin costo"}</p>
      {totalFotos > 0 ? (
        <p className={`${estilos.dato} ${estilos.cantidadFotos}`}>
          <a className={estilos.enlace} href={reserva.enlace}>
            {totalFotos === 1 ? "1 foto" : `${totalFotos} fotos`}
          </a>
        </p>
      ) : null}
      <div className={estilos.acciones}>
        <a className={`${estilos.boton} ${estilos.botonSecundario}`} href={reserva.enlace}>
          Ver detalle
        </a>
        {dejarResena ? (
          <a className={estilos.boton} href={reserva.enlace}>
            Deja tu reseña
          </a>
        ) : null}
      </div>
    </article>
  );
}

export const TEXTO_SIN_CREDITO = "No tienes crédito por ahora.";
export const TEXTO_RENOVAR_PARA_USAR_CREDITO = "Tu membresía venció. Renuévala para poder usar tu crédito.";

// Crédito en horas (ítem 14): saldo y próximo vencimiento. Con la membresía vencida se muestra el saldo pero no se ofrece
// reservar: hace falta renovar (ADR 0012). El detalle (lotes y movimientos) está en /cuenta/credito.
export function TarjetaCredito({ credito, zona }: { credito: RespuestaPerfil["credito"]; zona: string }) {
  return (
    <section className={estilos.seccion} aria-label="Tu crédito">
      <h2 className={estilos.seccionTitulo}>Tu crédito</h2>
      <div className={estilos.tarjeta}>
        {credito.saldo_horas > 0 ? (
          <>
            <p className={estilos.tarjetaTitulo}>Tienes {formatearHoras(credito.saldo_horas)} de crédito</p>
            {credito.proximo_vencimiento ? (
              <p className={estilos.dato}>
                {formatearHoras(credito.proximo_vencimiento.horas)} vencen el {formatearFecha(credito.proximo_vencimiento.vence_en, zona)}.
              </p>
            ) : null}
            {credito.membresia_vencida ? <p className={estilos.dato}>{TEXTO_RENOVAR_PARA_USAR_CREDITO}</p> : null}
            <div className={estilos.acciones}>
              <a className={`${estilos.boton} ${estilos.botonSecundario}`} href="/cuenta/credito">
                Ver mi crédito
              </a>
            </div>
          </>
        ) : (
          <p className={estilos.dato}>{TEXTO_SIN_CREDITO}</p>
        )}
      </div>
    </section>
  );
}

export function PerfilVista({ usuario, perfil, zona }: { usuario: Usuario; perfil: RespuestaPerfil; zona: string }) {
  return (
    <>
      <h1 className={estilos.titulo}>Hola, {usuario.nombre}</h1>
      <p className={estilos.subtitulo}>
        {usuario.correo} · {usuario.celular}
      </p>

      <Avisos avisos={perfil.avisos} usuarioId={usuario.id} zona={zona} />
      <AvisoRenovacion renovacion={perfil.renovacion} />
      <TarjetaMembresia membresia={perfil.membresia} zona={zona} renovacion={perfil.renovacion} />

      <TarjetaCredito credito={perfil.credito} zona={zona} />

      <section className={estilos.seccion} aria-label="Próximas limpiezas">
        <h2 className={estilos.seccionTitulo}>Próximas limpiezas</h2>
        {perfil.proximas.length === 0 ? (
          <p className={estilos.vacio}>No tienes limpiezas próximas</p>
        ) : (
          perfil.proximas.map((r: ProximaVista) => <ResumenDeReserva key={r.id} reserva={r} zona={zona} etiquetaEspera={r.estado === "pendiente"} />)
        )}
      </section>

      <section className={estilos.seccion} aria-label="Historial">
        <h2 className={estilos.seccionTitulo}>Historial</h2>
        {perfil.historial.length === 0 ? (
          <p className={estilos.vacio}>Aún no tienes historial</p>
        ) : (
          perfil.historial.map((r) => <ResumenDeReserva key={r.id} reserva={r} zona={zona} dejarResena={r.estado === "completada" && r.resena_estado == null} totalFotos={r.total_fotos} />)
        )}
      </section>
    </>
  );
}
