import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/cliente";
import { equipos, membresias, reservas } from "@/db/esquema";
import { moverAlPrimerEquipoLibre } from "../agenda/asignar";
import { transaccionDeEscritura, type BaseDatos, type Transaccion } from "../agenda/expirar";
import { isoConZona, rangoBloqueado, validarInicioServicio } from "../agenda/horario";
import { leerConfiguracion, type Configuracion } from "../configuracion";
import { leerEnvWhatsapp } from "../env";
import { ErrorApi } from "../errores";
import { dentroDelPlazo } from "../perfil/reservas";
import { formatearFecha } from "../perfil/textos";
import type { Usuario } from "../sesion";
import { esUuid } from "../uuid";
import { validar } from "../validacion-sesion";
import { ErrorFueraDePlazo, MENSAJE_RESERVA_NO_ENCONTRADA } from "./cancelar";
import { validarVigenciaPrimeraMembresia } from "./vigencia";
import { enlaceWhatsapp, mensajeDeCambioUrgente } from "./whatsapp";

// Reprogramar una reserva del CLIENTE (PRD, alcance punto 7; ADR 0007 y 0009). Se actualiza la MISMA fila (conserva id,
// pago, precio, estado y `primera_gratis`) al primer equipo libre. El horario nuevo cumple las reglas de una reserva
// nueva y se valida con las `horas_agenda` GUARDADAS, no con las de la configuración de hoy (ADR 0008).

export const esquemaReprogramar = z.object({
  inicio: z
    .string({ error: "Elige el día y la hora de tu limpieza." })
    .max(40, { error: "El día y la hora no son válidos." })
    .pipe(z.iso.datetime({ offset: true, error: "El día y la hora no son válidos." })),
});

export type DependenciasReprogramar = {
  base: () => Pick<BaseDatos, "transaction">;
  leerConfig: () => Promise<Configuracion>;
  numeroWhatsapp: () => string | null;
  // Equipos candidatos en orden. Sin esto se leen los activos dentro de la transacción.
  equipoIds?: number[];
};

const porDefecto: DependenciasReprogramar = {
  base: () => db(),
  leerConfig: () => leerConfiguracion(),
  numeroWhatsapp: () => leerEnvWhatsapp().WHATSAPP_NUMERO,
};

export const MENSAJE_MISMO_HORARIO = "Elige un horario distinto al que ya tienes.";
export const MENSAJE_NO_REPROGRAMABLE: Record<"completada" | "cancelada" | "expirada", string> = {
  completada: "Esa limpieza ya se realizó, así que no se puede cambiar.",
  cancelada: "Esa reserva está cancelada, así que no se puede cambiar.",
  expirada: "Esa reserva ya expiró. Elige un nuevo día y hora desde tu perfil.",
};

export type RespuestaReprogramar = {
  reserva: {
    id: string;
    estado: string;
    inicio: string;
    fin: string;
    expira_en: string | null;
    requiere_apoyo: boolean;
    apoyo_estado: string | null;
  };
};

export async function reprogramarReserva(
  { usuario, reservaId, cuerpo, ahora }: { usuario: Usuario; reservaId: string; cuerpo: unknown; ahora: Date },
  dependencias: DependenciasReprogramar = porDefecto,
): Promise<RespuestaReprogramar> {
  // --- Fuera de la transacción: lo que no toca la base ---
  const datos = validar(esquemaReprogramar, cuerpo);
  if (!esUuid(reservaId)) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
  const config = await dependencias.leerConfig();
  const zona = config.horario_atencion.zona;
  const nuevoInicio = new Date(datos.inicio);

  return transaccionDeEscritura(async (tx: Transaccion) => {
    const [reserva] = await tx
      .select()
      .from(reservas)
      .where(and(eq(reservas.id, reservaId), eq(reservas.usuarioId, usuario.id)))
      .for("update");
    if (!reserva) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
    if (reserva.estado === "completada" || reserva.estado === "cancelada" || reserva.estado === "expirada") {
      throw ErrorApi.conflicto(MENSAJE_NO_REPROGRAMABLE[reserva.estado]);
    }

    if (!dentroDelPlazo(config, ahora, reserva.inicio)) {
      throw new ErrorFueraDePlazo(
        `Solo puedes cambiar el horario hasta ${config.cancelacion_minima_horas} horas antes del servicio. Si necesitas ayuda, escríbenos por WhatsApp.`,
        enlaceWhatsapp({
          numero: dependencias.numeroWhatsapp(),
          mensaje: mensajeDeCambioUrgente({
            nombre: usuario.nombre,
            celular: usuario.celular,
            accion: "cambiar",
            servicio: reserva.tipo === "paquete" ? { tipo: "paquete", horas: Number(reserva.horasTrabajo) } : { tipo: reserva.tipo },
            inicio: reserva.inicio,
            zona,
            distrito: reserva.distrito,
            calle: reserva.calle,
            numero: reserva.numero,
            departamento: reserva.departamento,
          }),
        }),
      );
    }

    const movida = await reprogramarEnTransaccion(tx, { config, ahora, reserva, nuevoInicio, equipoIds: dependencias.equipoIds });

    return {
      reserva: {
        id: movida.id,
        estado: movida.estado,
        inicio: isoConZona(movida.inicio, zona),
        fin: isoConZona(movida.fin, zona),
        expira_en: movida.expiraEn ? isoConZona(movida.expiraEn, zona) : null,
        requiere_apoyo: movida.requiereApoyo,
        apoyo_estado: movida.apoyoEstado,
      },
    };
  }, dependencias.base());
}

type ReservaAMover = Pick<
  typeof reservas.$inferSelect,
  "id" | "usuarioId" | "membresiaId" | "equipoId" | "horasAgenda" | "inicio" | "requiereApoyo" | "apoyoEstado"
>;

// Núcleo común de reprogramar (cliente, ítem 12, y administrador, ítem 16): ya con la reserva bloqueada y autorizada, valida
// el horario nuevo, la vigencia de la membresía de LA RESERVA y «horario distinto», y la mueve al primer equipo libre. NO decide
// quién puede hacerlo ni el plazo de 24 horas: eso es de cada llamador (el cliente filtra por dueño y exige el plazo; el
// administrador no). Va dentro de `transaccionDeEscritura`. Devuelve la fila ya movida.
export async function reprogramarEnTransaccion(
  tx: Transaccion,
  { config, ahora, reserva, nuevoInicio, equipoIds }: { config: Configuracion; ahora: Date; reserva: ReservaAMover; nuevoInicio: Date; equipoIds?: number[] },
): Promise<typeof reservas.$inferSelect> {
  const zona = config.horario_atencion.zona;
  const horasAgenda = Number(reserva.horasAgenda);
  validarInicioServicio(config, ahora, nuevoInicio, horasAgenda);

  // Vigencia: con la membresía activa, el servicio debe empezar antes de su fin; con la primera todavía pendiente, dentro de
  // los `membresia_meses` siguientes a hoy (como al crear la reserva).
  const [membresia] = await tx
    .select({ estado: membresias.estado, fin: membresias.fin })
    .from(membresias)
    .where(and(eq(membresias.id, reserva.membresiaId), eq(membresias.usuarioId, reserva.usuarioId)))
    .limit(1);
  if (membresia?.estado === "activa" && membresia.fin) {
    if (nuevoInicio.getTime() >= membresia.fin.getTime()) {
      throw ErrorApi.invalido(`Tu membresía cubre hasta el ${formatearFecha(membresia.fin, zona)}. Elige una fecha anterior.`);
    }
  } else {
    validarVigenciaPrimeraMembresia(config, ahora, nuevoInicio);
  }

  if (nuevoInicio.getTime() === reserva.inicio.getTime()) throw ErrorApi.invalido(MENSAJE_MISMO_HORARIO);

  // El equipo actual primero: si sigue libre, la reserva no cambia de equipo.
  const otros = equipoIds ?? (await equiposActivos(tx));
  const candidatos = [reserva.equipoId, ...otros.filter((id) => id !== reserva.equipoId)];
  const rango = rangoBloqueado(config, nuevoInicio, horasAgenda);
  return moverAlPrimerEquipoLibre(tx, reserva.id, candidatos, {
    inicio: rango.inicio,
    fin: rango.fin,
    finBloqueo: rango.finBloqueo,
    // El administrador coordinó a la persona de apoyo para otra fecha: se vuelve a coordinar. La nota se conserva.
    apoyoEstado: reserva.requiereApoyo && reserva.apoyoEstado === "coordinado" ? "por_coordinar" : undefined,
  });
}

async function equiposActivos(tx: Pick<Transaccion, "select">): Promise<number[]> {
  const filas = await tx.select({ id: equipos.id }).from(equipos).where(eq(equipos.activo, true)).orderBy(asc(equipos.id));
  return filas.map((f) => f.id);
}
