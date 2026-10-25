import { eq, getTableColumns, sql } from "drizzle-orm";
import { db } from "@/db/cliente";
import { reservas } from "@/db/esquema";
import { transaccionDeEscritura, type BaseDatos } from "../../agenda/expirar";
import { isoConZona } from "../../agenda/horario";
import { leerConfiguracion, type Configuracion } from "../../configuracion";
import { ErrorApi } from "../../errores";
import { esquemaReprogramar, reprogramarEnTransaccion } from "../../reservas/reprogramar";
import { esUuid } from "../../uuid";
import { validar } from "../../validacion-sesion";
import { MENSAJE_RESERVA_NO_ENCONTRADA } from "./completar";
import { esViva, NOMBRE_DEL_ESTADO } from "./estado";

export const MENSAJE_YA_EMPEZO = "El servicio ya empezó; no se puede reprogramar.";

export type DependenciasReprogramarAdmin = {
  base: () => Pick<BaseDatos, "transaction">;
  leerConfig: () => Promise<Configuracion>;
  // Equipos candidatos en orden. Sin esto se leen los activos dentro de la transacción (solo lo fijan las pruebas contra Neon).
  equipoIds?: number[];
};
const porDefecto: DependenciasReprogramarAdmin = { base: () => db(), leerConfig: () => leerConfiguracion() };

export type RespuestaReprogramarAdmin = {
  reserva: {
    id: string;
    estado: string;
    inicio: string;
    fin: string;
    expira_en: string | null;
    requiere_apoyo: boolean;
    apoyo_estado: string | null;
    reprogramada_por: string;
    reprogramada_en: string;
  };
};

// El administrador reprograma una reserva viva A NOMBRE DEL CLIENTE (design de gestion-de-reservas-y-apoyo, decisión 7).
//
// Es la salida cuando no se consigue a la persona de apoyo (PRD, alcance 4). DECISIÓN DEL USUARIO (2026-10-21), PENDIENTE DE
// CONFIRMAR POR EL NEGOCIO (`<!-- REVISAR -->` del PRD): se reprograma con el cliente por WhatsApp (fuera del sistema) y el
// pago se conserva; no se cancela ni se convierte en crédito, y el precio no cambia. El sistema no avisa al cliente.
//
// Reutiliza el núcleo de #12 (`reprogramarEnTransaccion`: horario válido con las `horas_agenda` GUARDADAS, vigencia de la
// membresía de la reserva, «horario distinto» y `moverAlPrimerEquipoLibre`) sin copiarlo. Se actualiza la MISMA fila: conserva
// id, pago, precio, estado, `expira_en` y `primera_gratis`. Si la reserva requiere apoyo, el núcleo devuelve `apoyo_estado` a
// `por_coordinar` y conserva la nota.
//
// SUPUESTO (a confirmar con el negocio): aquí NO rige la regla de 24 horas, que limita al cliente (ADR 0009). El administrador
// ya acordó el cambio por WhatsApp y la falta de apoyo suele descubrirse cerca de la fecha. Se mantiene la anticipación de 48
// horas para el horario NUEVO y se rechaza un servicio que ya empezó. Quitar la excepción es agregar la comparación de 24 h.
export async function reprogramarReservaPorAdmin(
  { reservaId, cuerpo, adminId, ahora }: { reservaId: string; cuerpo: unknown; adminId: string; ahora: Date },
  dependencias: DependenciasReprogramarAdmin = porDefecto,
): Promise<RespuestaReprogramarAdmin> {
  const datos = validar(esquemaReprogramar, cuerpo);
  if (!esUuid(reservaId)) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
  const config = await dependencias.leerConfig();
  const zona = config.horario_atencion.zona;
  const nuevoInicio = new Date(datos.inicio);

  return transaccionDeEscritura(async (tx) => {
    // Sin filtrar por dueño: el administrador mueve la reserva de cualquier cliente.
    const [reserva] = await tx
      .select({ ...getTableColumns(reservas), yaEmpezo: sql<boolean>`(${reservas.inicio} <= now())` })
      .from(reservas)
      .where(eq(reservas.id, reservaId))
      .for("update");
    if (!reserva) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
    // Las vencidas ya se marcaron al abrir la transacción: una `pendiente` vencida llega como `expirada`.
    if (!esViva(reserva.estado)) throw ErrorApi.conflicto(`Esa reserva está ${NOMBRE_DEL_ESTADO[reserva.estado]}, así que no se puede reprogramar.`);
    if (reserva.yaEmpezo) throw ErrorApi.conflicto(MENSAJE_YA_EMPEZO);

    const movida = await reprogramarEnTransaccion(tx, { config, ahora, reserva, nuevoInicio, equipoIds: dependencias.equipoIds });

    // Segundo UPDATE, aparte de `moverAlPrimerEquipoLibre`: no depende de la forma de sus `cambios` y esta sentencia no
    // tiene restricción de exclusión que la afecte. Quién y cuándo, con el reloj de la base.
    const [registro] = await tx
      .update(reservas)
      .set({ reprogramadaPor: adminId, reprogramadaEn: sql`now()` })
      .where(eq(reservas.id, movida.id))
      .returning({ reprogramadaPor: reservas.reprogramadaPor, reprogramadaEn: reservas.reprogramadaEn });

    return {
      reserva: {
        id: movida.id,
        estado: movida.estado,
        inicio: isoConZona(movida.inicio, zona),
        fin: isoConZona(movida.fin, zona),
        expira_en: movida.expiraEn ? isoConZona(movida.expiraEn, zona) : null,
        requiere_apoyo: movida.requiereApoyo,
        apoyo_estado: movida.apoyoEstado,
        reprogramada_por: registro.reprogramadaPor!,
        reprogramada_en: isoConZona(registro.reprogramadaEn!, zona),
      },
    };
  }, dependencias.base());
}
