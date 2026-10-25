import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/cliente";
import { equipos, pagos, reservas } from "@/db/esquema";
import { insertarEnPrimerEquipoLibre, type FilaReserva } from "../agenda/asignar";
import { transaccionDeEscritura, type BaseDatos, type Transaccion } from "../agenda/expirar";
import { leerCreditoParaReservar, tomarCredito } from "../creditos/aplicar";
import { isoConZona, rangoBloqueado, validarInicioServicio } from "../agenda/horario";
import { leerConfiguracion, type Configuracion } from "../configuracion";
import { leerEnvWhatsapp } from "../env";
import { ErrorApi } from "../errores";
import type { Usuario } from "../sesion";
import { esUuid } from "../uuid";
import { validar } from "../validacion-sesion";
import { leerMembresiaQueAutoriza } from "./membresia-vigente";
import { comprobarElegible, MENSAJE_PAGO_NO_ENCONTRADO, MENSAJE_SIN_HORARIO_PENDIENTE, reservaOrigenDelPago } from "./nuevo-horario-datos";
import { MENSAJE_SIN_MEMBRESIA_ACTIVA } from "./miembro";
import { traducirUnicidad } from "./unicidad";
import { validarVigenciaDeMembresia } from "./vigencia";
import { enlaceWhatsapp, mensajeDeReserva } from "./whatsapp";

// Cuerpo del POST: solo `inicio`. Zod descarta lo demás (`comprobante`, `monto`, `metodo`): el pago ya está hecho y el
// cliente no puede cambiar el servicio, la dirección ni el monto con él (ADR 0009; design, decisión 6).
export const esquemaNuevoHorario = z.object({
  inicio: z
    .string({ error: "Elige el día y la hora de tu limpieza." })
    .max(40, { error: "El día y la hora no son válidos." })
    .pipe(z.iso.datetime({ offset: true, error: "El día y la hora no son válidos." })),
});

export const MENSAJE_GRATIS_TOMADA_AL_REUBICAR =
  "Otra cuenta ya recibió la limpieza gratis de esta dirección. Escríbenos por WhatsApp para coordinar tu limpieza.";

export type DependenciasNuevoHorario = {
  base: () => Pick<BaseDatos, "transaction">;
  leerConfig: () => Promise<Configuracion>;
  numeroWhatsapp: () => string | null;
  // Equipos candidatos en orden. Sin esto se leen los activos dentro de la transacción.
  equipoIds?: number[];
};

const porDefecto: DependenciasNuevoHorario = {
  base: () => db(),
  leerConfig: () => leerConfiguracion(),
  numeroWhatsapp: () => leerEnvWhatsapp().WHATSAPP_NUMERO,
};

export type RespuestaNuevoHorario = {
  reserva: {
    id: string;
    estado: string;
    servicio: { tipo: "estandar" | "profunda" | "mudanza"; dormitorios: number; banos: number } | { tipo: "paquete"; horas: number };
    inicio: string;
    fin: string;
    expira_en: string | null;
    monto: number;
    precio_lista: number;
    horas_gratis_aplicadas: number;
    requiere_apoyo: boolean;
    apoyo_estado: string | null;
  };
  pago: { id: string; concepto: string; monto: number; metodo: string; estado: string };
  // Horas de crédito de la reserva original que ya no se pudieron volver a tomar (el cliente las gastó o vencieron mientras
  // esperaba): 0 en el caso normal. La reserva se crea igual, porque el cliente ya pagó (ítem 14, decisión 4).
  credito_faltante_horas: number;
  whatsapp: string | null;
};

// Crea la reserva `confirmada` que reutiliza un pago YA aprobado (aprobación tardía o cancelación del administrador). Va
// dentro de `transaccionDeEscritura`, bloquea el pago del dueño con FOR UPDATE y copia de la reserva original el servicio,
// la dirección, las horas gratis, el crédito, el descuento y el monto: no recalcula nada, porque el pago ya cubre ese
// monto y recalcular con una `configuracion` cambiada lo dejaría desalineado (design, decisión 6).
//
// Decisión 8 del design: el pago de una reserva que el CLIENTE canceló NO se reutiliza (409 pago_en_credito): lo pagado va
// a crédito en horas (ADR 0012, ítem #14) y reutilizarlo además lo cobraría dos veces. La regla es la de
// `pagosParaElegirHorario` (#12), llamada desde `comprobarElegible`; aquí no se reescribe.
//
// Idempotencia: un reintento tras un COMMIT perdido choca con `reservas_un_pago_por_reserva_viva` y responde 409 «Ese pago ya
// tiene una reserva asociada.», veraz y sin duplicar.
export async function crearReservaDeNuevoHorario(
  { usuario, pagoId, cuerpo, ahora }: { usuario: Usuario; pagoId: string; cuerpo: unknown; ahora: Date },
  dependencias: DependenciasNuevoHorario = porDefecto,
): Promise<RespuestaNuevoHorario> {
  // --- Fuera de la transacción ---
  const datos = validar(esquemaNuevoHorario, cuerpo);
  if (!esUuid(pagoId)) throw ErrorApi.noEncontrado(MENSAJE_PAGO_NO_ENCONTRADO);
  const config = await dependencias.leerConfig();
  const zona = config.horario_atencion.zona;
  const inicio = new Date(datos.inicio);

  let guardado: { reserva: typeof reservas.$inferSelect; pago: typeof pagos.$inferSelect; origen: typeof reservas.$inferSelect; faltante: number };
  try {
    guardado = await transaccionDeEscritura(async (tx: Transaccion) => {
      const [pago] = await tx
        .select()
        .from(pagos)
        .where(and(eq(pagos.id, pagoId), eq(pagos.usuarioId, usuario.id)))
        .for("update");
      if (!pago) throw ErrorApi.noEncontrado(MENSAJE_PAGO_NO_ENCONTRADO);
      await comprobarElegible(tx, usuario.id, pago);
      const origen = await reservaOrigenDelPago(tx, pago.id);
      if (!origen) throw ErrorApi.conflicto(MENSAJE_SIN_HORARIO_PENDIENTE);

      const horasAgenda = Number(origen.horasAgenda);
      validarInicioServicio(config, ahora, inicio, horasAgenda);

      const membresia = await leerMembresiaQueAutoriza(tx, usuario.id);
      if (!membresia) throw ErrorApi.invalido(MENSAJE_SIN_MEMBRESIA_ACTIVA);
      validarVigenciaDeMembresia(config, membresia.fin, inicio);

      // Crédito: la reserva original lo devolvió a su lote al expirar, así que se vuelve a tomar (decisión 4 de credito-en-horas).
      // Los lotes se bloquean ANTES de insertar la reserva (mismo orden que la reserva de miembro: sin interbloqueos).
      const creditoOriginal = Number(origen.creditoAplicado);
      const lotes = creditoOriginal > 0 ? await leerCreditoParaReservar(tx, usuario.id) : [];

      const rango = rangoBloqueado(config, inicio, horasAgenda);
      const candidatos = dependencias.equipoIds ?? (await equiposActivos(tx));
      const fila: FilaReserva = {
        usuarioId: usuario.id,
        membresiaId: membresia.id,
        pagoId: pago.id,
        tipo: origen.tipo,
        dormitorios: origen.dormitorios,
        banos: origen.banos,
        horasTrabajo: origen.horasTrabajo,
        horasAgenda: origen.horasAgenda,
        requiereApoyo: origen.requiereApoyo,
        // Es un horario nuevo: el administrador vuelve a coordinar a la persona de apoyo.
        apoyoEstado: origen.requiereApoyo ? "por_coordinar" : null,
        distrito: origen.distrito,
        calle: origen.calle,
        numero: origen.numero,
        departamento: origen.departamento,
        departamentoNormalizado: origen.departamentoNormalizado,
        referencias: origen.referencias,
        direccionNormalizada: origen.direccionNormalizada,
        inicio: rango.inicio,
        fin: rango.fin,
        finBloqueo: rango.finBloqueo,
        precioLista: origen.precioLista,
        horasGratisAplicadas: origen.horasGratisAplicadas,
        creditoAplicado: origen.creditoAplicado,
        descuento: origen.descuento,
        monto: origen.monto,
        primeraGratis: origen.primeraGratis,
        estado: "confirmada",
        expiraEn: null,
      };
      const reserva = await insertarEnPrimerEquipoLibre(tx, candidatos, fila);
      // Toma lo que haya: si no alcanza, la reserva se crea igual y el faltante queda registrado en la respuesta y en el
      // detalle del pago del administrador (crédito aplicado de la reserva menos lo que sumen sus usos).
      const { faltante } = await tomarCredito(tx, { lotes, reservaId: reserva.id, horas: creditoOriginal, estado: "consumido", permitirFaltante: true });
      return { reserva, pago, origen, faltante };
    }, dependencias.base());
  } catch (error) {
    throw traducirNuevoHorario(error);
  }

  // --- Fuera, después del commit ---
  const { reserva, pago, origen, faltante } = guardado;
  const servicio = servicioDe(origen);
  const mensaje = mensajeDeReserva({
    estado: "confirmada",
    nombre: usuario.nombre,
    celular: usuario.celular,
    servicio: servicio.tipo === "paquete" ? { tipo: "paquete", horas: servicio.horas } : { tipo: servicio.tipo },
    inicio: reserva.inicio,
    zona,
    distrito: reserva.distrito,
    calle: reserva.calle,
    numero: reserva.numero,
    departamento: reserva.departamento,
  });

  return {
    reserva: {
      id: reserva.id,
      estado: reserva.estado,
      servicio,
      inicio: isoConZona(reserva.inicio, zona),
      fin: isoConZona(reserva.fin, zona),
      expira_en: reserva.expiraEn ? isoConZona(reserva.expiraEn, zona) : null,
      monto: reserva.monto,
      precio_lista: reserva.precioLista,
      horas_gratis_aplicadas: Number(reserva.horasGratisAplicadas),
      requiere_apoyo: reserva.requiereApoyo,
      apoyo_estado: reserva.apoyoEstado,
    },
    pago: { id: pago.id, concepto: pago.concepto, monto: pago.monto, metodo: pago.metodo, estado: pago.estado },
    credito_faltante_horas: faltante,
    whatsapp: enlaceWhatsapp({ numero: dependencias.numeroWhatsapp(), mensaje }),
  };
}

function servicioDe(r: typeof reservas.$inferSelect): RespuestaNuevoHorario["reserva"]["servicio"] {
  return r.tipo === "paquete"
    ? { tipo: "paquete", horas: Number(r.horasTrabajo) }
    : { tipo: r.tipo, dormitorios: r.dormitorios as number, banos: r.banos as number };
}

// La limpieza gratis tomada por otra cuenta mientras la reserva original estaba expirada: el cliente ya pagó, así que la
// salida es coordinar por WhatsApp (política de negocio abierta, Open Questions 2 del design). El resto, como siempre.
function traducirNuevoHorario(error: unknown): unknown {
  const traducido = traducirUnicidad(error);
  if (traducido instanceof ErrorApi && traducido.codigo === "limpieza_gratis_usada") {
    return new ErrorApi(409, "limpieza_gratis_usada", MENSAJE_GRATIS_TOMADA_AL_REUBICAR);
  }
  return traducido;
}

async function equiposActivos(tx: Pick<Transaccion, "select">): Promise<number[]> {
  const filas = await tx.select({ id: equipos.id }).from(equipos).where(eq(equipos.activo, true)).orderBy(asc(equipos.id));
  return filas.map((f) => f.id);
}
