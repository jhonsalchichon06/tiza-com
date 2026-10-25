import { and, asc, eq, sql } from "drizzle-orm";
import { equipos, pagos, reservas } from "@/db/esquema";
import { insertarEnPrimerEquipoLibre, type FilaReserva } from "../agenda/asignar";
import { transaccionDeEscritura, type Transaccion } from "../agenda/expirar";
import { isoConZona, rangoBloqueado, validarInicioServicio } from "../agenda/horario";
import { horasCubiertas, leerCreditoParaReservar, tomarCredito } from "../creditos/aplicar";
import { claveHogar, validarDireccion } from "../direccion";
import { ErrorApi } from "../errores";
import { pagosParaElegirHorario } from "../perfil/nuevo-horario";
import { calcularServicio } from "../precios";
import type { Usuario } from "../sesion";
import { validar } from "../validacion-sesion";
import type { DependenciasCrear, RespuestaReservaMiembro } from "./crear";
import { esquemaReservaMiembro } from "./esquema-entrada";
import { decidirLimpiezaGratis } from "./gratis";
import { leerMembresiaQueAutoriza } from "./membresia-vigente";
import { crearPagoInterno } from "./pago-interno";
import { MENSAJE_RESERVA_EN_ESPERA, traducirUnicidad } from "./unicidad";
import { validarVigenciaDeMembresia } from "./vigencia";
import { enlaceWhatsapp, mensajeDeReserva } from "./whatsapp";

export type DependenciasMiembro = DependenciasCrear;

export const MENSAJE_HORARIO_PENDIENTE = "Tienes un pago aprobado esperando horario. Elige tu nuevo día y hora desde tu cuenta.";
export const MENSAJE_SIN_MEMBRESIA_ACTIVA = "Necesitas una membresía vigente para reservar. Renueva tu membresía para seguir reservando.";
export const MENSAJE_COMPROBANTE_REQUERIDO = "Sube el comprobante de tu pago para continuar.";
export const MENSAJE_METODO_REQUERIDO = "Elige cómo vas a pagar: Yape o transferencia.";

// Reserva pagada de un miembro con membresía `activa` (reservar-como-miembro-activo, decisiones 2, 3, 5, 7 y 9). Lo que puede
// fallar sin tocar la base se valida ANTES de abrir la transacción; el estado del cliente, la vigencia contra el `fin`
// leído, las horas gratis, el crédito y el monto se deciden DENTRO, en una sola transacción de escritura.
export async function crearReservaDeMiembro(
  { usuario, cuerpo, ahora }: { usuario: Usuario; cuerpo: unknown; ahora: Date },
  dependencias: DependenciasMiembro,
): Promise<RespuestaReservaMiembro> {
  // --- Fuera de la transacción ---
  const datos = validar(esquemaReservaMiembro, cuerpo);
  const direccion = validarDireccion(datos.direccion);
  // El comprobante solo se verifica si llegó: el monto aún no se conoce y puede ser 0 (entonces se descarta).
  const imagen = datos.comprobante
    ? await dependencias.verificarImagen({ ruta: datos.comprobante, usuario: { id: usuario.id, rol: usuario.rol } })
    : null;
  const config = await dependencias.leerConfig();
  const zona = config.horario_atencion.zona;

  const inicio = new Date(datos.inicio);
  const { horas_agenda: horasAgendaPrevias } = calcularServicio(config, datos.servicio);
  validarInicioServicio(config, ahora, inicio, horasAgendaPrevias);

  // --- Dentro de la transacción (expira las vencidas antes de leer los límites del cliente) ---
  let guardado: { reserva: typeof reservas.$inferSelect; pago: typeof pagos.$inferSelect };
  try {
    guardado = await transaccionDeEscritura(async (tx: Transaccion) => {
      // (a) Una sola reserva en espera por cliente, también cuando el monto sea 0.
      const enEspera = await tx
        .select({ id: reservas.id })
        .from(reservas)
        .where(and(eq(reservas.usuarioId, usuario.id), eq(reservas.estado, "pendiente")))
        .limit(1);
      if (enEspera.length > 0) throw new ErrorApi(409, "en_espera", MENSAJE_RESERVA_EN_ESPERA);

      // (b) Un pago aprobado esperando horario se usa primero (evita pagar dos veces el mismo servicio).
      if ((await pagosParaElegirHorario(tx, usuario.id)).length > 0) {
        throw new ErrorApi(409, "horario_pendiente", MENSAJE_HORARIO_PENDIENTE);
      }

      // (c) La membresía que autoriza, leída aquí, y la vigencia contra su `fin`.
      const membresia = await leerMembresiaQueAutoriza(tx, usuario.id);
      if (!membresia) throw ErrorApi.invalido(MENSAJE_SIN_MEMBRESIA_ACTIVA);
      validarVigenciaDeMembresia(config, membresia.fin, inicio);

      // (d) Horas gratis (cliente y hogar), (e) crédito en horas y (f) cálculo del monto. El crédito se lee DESPUÉS de comprobar
      // la espera y la vigencia de la membresía (sin membresía vigente no hay reserva ni uso de crédito, ADR 0008) y con los
      // lotes bloqueados (`FOR UPDATE`): dos reservas simultáneas del mismo cliente no usan las mismas horas (ADR 0012).
      const gratis = await decidirLimpiezaGratis(tx, usuario.id, claveHogar(direccion));
      const previo = calcularServicio(config, { ...datos.servicio, aplicaGratis: gratis });
      const lotes = await leerCreditoParaReservar(tx, usuario.id);
      const creditoHoras = horasCubiertas(lotes, previo.horas_cobrar);
      const calculo = calcularServicio(config, { ...datos.servicio, aplicaGratis: gratis, creditoHoras });
      const rango = rangoBloqueado(config, inicio, calculo.horas_agenda);

      // (g) Con algo que pagar: método, comprobante y pago pendiente de concepto `reserva` (sin membresía). Sin nada que
      // pagar: pago interno aprobado y el comprobante enviado de más se ignora (nunca se guarda).
      const conPago = calculo.monto > 0;
      let pago: typeof pagos.$inferSelect;
      if (conPago) {
        if (!datos.metodo) throw new ErrorApi(422, "comprobante_requerido", MENSAJE_METODO_REQUERIDO);
        if (!imagen) throw new ErrorApi(422, "comprobante_requerido", MENSAJE_COMPROBANTE_REQUERIDO);
        [pago] = await tx
          .insert(pagos)
          .values({ usuarioId: usuario.id, concepto: "reserva", membresiaId: null, monto: calculo.monto, metodo: datos.metodo, comprobanteRuta: imagen.ruta, estado: "pendiente" })
          .returning();
      } else {
        pago = await crearPagoInterno(tx, { usuarioId: usuario.id, concepto: "reserva" });
      }

      // (h) La reserva: `pendiente` con plazo de la base, o `confirmada` sin plazo. Apunta a la membresía que autoriza.
      const candidatos = dependencias.equipoIds ?? (await equiposActivos(tx));
      const fila: FilaReserva = {
        usuarioId: usuario.id,
        membresiaId: membresia.id,
        pagoId: pago.id,
        tipo: datos.servicio.tipo,
        dormitorios: datos.servicio.tipo === "paquete" ? null : datos.servicio.dormitorios,
        banos: datos.servicio.tipo === "paquete" ? null : datos.servicio.banos,
        horasTrabajo: String(calculo.horas_trabajo),
        horasAgenda: String(calculo.horas_agenda),
        requiereApoyo: calculo.requiere_apoyo,
        apoyoEstado: calculo.requiere_apoyo ? "por_coordinar" : null,
        distrito: direccion.distrito,
        calle: direccion.calle,
        numero: direccion.numero,
        departamento: direccion.departamento,
        departamentoNormalizado: direccion.departamentoNormalizado,
        referencias: direccion.referencias,
        direccionNormalizada: direccion.direccionNormalizada,
        inicio: rango.inicio,
        fin: rango.fin,
        finBloqueo: rango.finBloqueo,
        precioLista: calculo.precio_lista,
        horasGratisAplicadas: String(calculo.horas_gratis_aplicadas),
        creditoAplicado: String(calculo.credito_aplicado),
        descuento: calculo.descuento,
        monto: calculo.monto,
        primeraGratis: gratis,
        estado: conPago ? "pendiente" : "confirmada",
        expiraEn: conPago ? plazoDeEspera(config.espera_pago_horas) : null,
      };
      const reserva = await insertarEnPrimerEquipoLibre(tx, candidatos, fila);
      // Con la reserva ya insertada (el uso necesita su id) se descuenta el crédito: `consumido` si nace confirmada (cubierta
      // del todo), `reservado` si nace pendiente. Un fallo aquí deshace toda la transacción.
      await tomarCredito(tx, { lotes, reservaId: reserva.id, horas: calculo.credito_aplicado, estado: conPago ? "reservado" : "consumido" });
      return { reserva, pago };
    }, dependencias.base());
  } catch (error) {
    throw traducirUnicidad(error);
  }

  // --- Fuera, después del commit ---
  const { reserva, pago } = guardado;
  const servicio = datos.servicio.tipo === "paquete" ? ({ tipo: "paquete", horas: datos.servicio.horas } as const) : datos.servicio;
  const mensaje = mensajeDeReserva({
    estado: reserva.estado === "confirmada" ? "confirmada" : "pendiente",
    nombre: usuario.nombre,
    celular: usuario.celular,
    servicio: datos.servicio.tipo === "paquete" ? { tipo: "paquete", horas: datos.servicio.horas } : { tipo: datos.servicio.tipo },
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
    },
    membresia: null,
    pago: { id: pago.id, concepto: pago.concepto, monto: pago.monto, metodo: pago.metodo, estado: pago.estado },
    whatsapp: enlaceWhatsapp({ numero: dependencias.numeroWhatsapp(), mensaje }),
  };
}

// El plazo se fija con el reloj de la base, igual que `reservaActiva` y `expirarVencidas`.
const plazoDeEspera = (horas: number) => sql`now() + make_interval(hours => ${horas}::int)`;

async function equiposActivos(tx: Pick<Transaccion, "select">): Promise<number[]> {
  const filas = await tx.select({ id: equipos.id }).from(equipos).where(eq(equipos.activo, true)).orderBy(asc(equipos.id));
  return filas.map((f) => f.id);
}
