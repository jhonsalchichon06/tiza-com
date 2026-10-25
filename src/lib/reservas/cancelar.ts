import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/cliente";
import { pagos, reservas } from "@/db/esquema";
import { transaccionDeEscritura, type BaseDatos, type Transaccion } from "../agenda/expirar";
import { isoConZona } from "../agenda/horario";
import { leerConfiguracion, type Configuracion } from "../configuracion";
import type { Distrito } from "../distritos";
import { leerEnvWhatsapp } from "../env";
import { ErrorApi } from "../errores";
import { dentroDelPlazo } from "../perfil/reservas";
import type { Usuario } from "../sesion";
import { esUuid } from "../uuid";
import { cancelarConCredito } from "../creditos/transiciones";
import { decidirLimpiezaGratis } from "./gratis";
import { enlaceWhatsapp, mensajeDeCambioUrgente } from "./whatsapp";

// Cancelación de una reserva por el CLIENTE (PRD, alcance punto 7; ADR 0008, 0009 y 0012). Una sola transacción:
// `FOR UPDATE` de la fila filtrada por el dueño, reglas de estado y de plazo, y UPDATE a `cancelada`. El horario queda
// libre en el mismo COMMIT porque `cancelada` sale del WHERE de la restricción de exclusión.
//
// No toca `pagos` ni `membresias`. Crédito en horas (ítem 14, ADR 0012): el UPDATE guarda `cancelada_en` junto con el estado y `cancelarConCredito` devuelve a su
// lote original las horas de crédito que usaba esta reserva y, si el pago está `aprobado`, genera el lote con lo pagado en
// dinero (horas de trabajo − horas gratis − crédito aplicado); si el pago estaba `pendiente`, el crédito se genera cuando el
// administrador lo apruebe. Se bloquea la reserva y luego los lotes (nunca el pago).

export type ConfigCancelar = Pick<Configuracion, "cancelacion_minima_horas" | "horario_atencion" | "credito_vence_meses">;

export type DependenciasCancelar = {
  base: () => Pick<BaseDatos, "transaction">;
  leerConfig: () => Promise<ConfigCancelar>;
  numeroWhatsapp: () => string | null;
};

const porDefecto: DependenciasCancelar = {
  base: () => db(),
  leerConfig: () => leerConfiguracion(),
  numeroWhatsapp: () => leerEnvWhatsapp().WHATSAPP_NUMERO,
};

export const MENSAJE_RESERVA_NO_ENCONTRADA = "No encontramos esa reserva.";
export const MENSAJE_YA_REALIZADA = "Esa limpieza ya se realizó, así que no se puede cancelar.";
export const MENSAJE_YA_EXPIRO = "Esa reserva ya expiró y su horario ya está libre.";
export const MENSAJE_CANCELADA_POR_TIZA = "Tiza ya canceló esa reserva, así que no hace falta cancelarla.";

// 409 con el código `fuera_de_plazo` y el enlace de WhatsApp (o null). La ruta lo convierte en la respuesta.
export class ErrorFueraDePlazo extends ErrorApi {
  constructor(
    mensaje: string,
    readonly whatsapp: string | null,
  ) {
    super(409, "fuera_de_plazo", mensaje);
  }
}

export type RespuestaCancelacion = {
  reserva: { id: string; estado: string; cancelada_por: string | null; inicio: string; fin: string };
  // La limpieza gratis cancelada sigue disponible para su hogar (ADR 0008).
  limpieza_gratis_conservada: boolean;
  // Horas de trabajo pagadas en dinero (no gratis ni con crédito) con el estado de su pago; la pantalla las traduce a un mensaje.
  horas_pagadas: number;
  pago: { estado: string } | null;
  // Crédito en horas de esta cancelación: lo que se generó (con su vencimiento) y lo que volvió a su lote.
  credito: { generado_horas: number; vence_en: string | null; devuelto_horas: number };
};

export async function cancelarReservaDelCliente(
  { usuario, reservaId, ahora }: { usuario: Usuario; reservaId: string; ahora: Date },
  dependencias: DependenciasCancelar = porDefecto,
): Promise<RespuestaCancelacion> {
  if (!esUuid(reservaId)) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
  const config = await dependencias.leerConfig();
  const zona = config.horario_atencion.zona;

  return transaccionDeEscritura(async (tx: Transaccion) => {
    const [reserva] = await tx
      .select()
      .from(reservas)
      .where(and(eq(reservas.id, reservaId), eq(reservas.usuarioId, usuario.id)))
      .for("update");
    if (!reserva) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);

    // Idempotente: un reintento tras un corte durante el COMMIT vería la reserva ya cancelada y no debe ver un error falso.
    const yaCancelada = reserva.estado === "cancelada" && reserva.canceladaPor === "cliente";
    if (!yaCancelada) {
      if (reserva.estado === "completada") throw ErrorApi.conflicto(MENSAJE_YA_REALIZADA);
      if (reserva.estado === "expirada") throw ErrorApi.conflicto(MENSAJE_YA_EXPIRO);
      if (reserva.estado === "cancelada") throw ErrorApi.conflicto(MENSAJE_CANCELADA_POR_TIZA);

      if (!dentroDelPlazo(config, ahora, reserva.inicio)) {
        const mensaje = `Solo puedes cancelar hasta ${config.cancelacion_minima_horas} horas antes del servicio. Si necesitas ayuda, escríbenos por WhatsApp.`;
        const enlace = enlaceWhatsapp({
          numero: dependencias.numeroWhatsapp(),
          mensaje: mensajeDeCambioUrgente({
            nombre: usuario.nombre,
            celular: usuario.celular,
            accion: "cancelar",
            servicio: reserva.tipo === "paquete" ? { tipo: "paquete", horas: Number(reserva.horasTrabajo) } : { tipo: reserva.tipo },
            inicio: reserva.inicio,
            zona,
            distrito: reserva.distrito,
            calle: reserva.calle,
            numero: reserva.numero,
            departamento: reserva.departamento,
          }),
        });
        throw new ErrorFueraDePlazo(mensaje, enlace);
      }
    }

    let credito: RespuestaCancelacion["credito"] = { generado_horas: 0, vence_en: null, devuelto_horas: 0 };
    const actual = yaCancelada
      ? reserva
      : (
          await tx
            .update(reservas)
            .set({ estado: "cancelada", canceladaPor: "cliente", canceladaEn: sql`now()`, expiraEn: null, actualizadaEn: sql`now()` })
            .where(and(eq(reservas.id, reserva.id), eq(reservas.usuarioId, usuario.id)))
            .returning()
        )[0];

    if (!yaCancelada) {
      const resultado = await cancelarConCredito(tx, actual, config.credito_vence_meses);
      credito = {
        generado_horas: resultado.generado?.horas ?? 0,
        vence_en: resultado.generado ? isoConZona(resultado.generado.venceEn, zona) : null,
        devuelto_horas: resultado.devueltoHoras,
      };
    }

    const [pago] = await tx
      .select({ estado: pagos.estado })
      .from(pagos)
      .where(and(eq(pagos.id, actual.pagoId), eq(pagos.usuarioId, usuario.id)))
      .limit(1);

    // Misma regla que aplica la reserva, dentro de la misma transacción y con la clave del hogar de la cancelada.
    const conservada = actual.primeraGratis
      ? await decidirLimpiezaGratis(tx, usuario.id, {
          distrito: actual.distrito as Distrito,
          direccionNormalizada: actual.direccionNormalizada,
          departamentoNormalizado: actual.departamentoNormalizado,
        })
      : false;

    const pagadas = Number(actual.horasTrabajo) - Number(actual.horasGratisAplicadas) - Number(actual.creditoAplicado);
    return {
      reserva: {
        id: actual.id,
        estado: actual.estado,
        cancelada_por: actual.canceladaPor,
        inicio: isoConZona(actual.inicio, zona),
        fin: isoConZona(actual.fin, zona),
      },
      limpieza_gratis_conservada: conservada,
      horas_pagadas: Math.max(0, pagadas),
      pago: pago ? { estado: pago.estado } : null,
      credito,
    };
  }, dependencias.base());
}
