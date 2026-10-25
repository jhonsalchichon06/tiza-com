import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/cliente";
import { equipos, membresias, pagos, reservas } from "@/db/esquema";
import { insertarEnPrimerEquipoLibre, type FilaReserva } from "../agenda/asignar";
import { transaccionDeEscritura, type BaseDatos, type Transaccion } from "../agenda/expirar";
import { isoConZona, rangoBloqueado, validarInicioServicio } from "../agenda/horario";
import { leerConfiguracion, type Configuracion } from "../configuracion";
import { claveHogar, validarDireccion } from "../direccion";
import { leerEnvWhatsapp } from "../env";
import { ErrorApi } from "../errores";
import { verificarImagenSubida, type ImagenVerificada } from "../imagenes/verificar";
import { cerrarMembresiasSinReenvio } from "../pagos/cierre";
import { reenvioHastaSql } from "../pagos/plazo";
import { calcularServicio } from "../precios";
import type { Usuario } from "../sesion";
import { validar } from "../validacion-sesion";
import { esquemaReserva } from "./esquema-entrada";
import { decidirLimpiezaGratis } from "./gratis";
import { MENSAJE_RESERVA_EN_ESPERA, traducirUnicidad } from "./unicidad";
import { crearReservaDeMiembro, type DependenciasMiembro } from "./miembro";
import { tieneMembresiaActiva } from "./membresia-vigente";
import { validarVigenciaPrimeraMembresia } from "./vigencia";
import { enlaceWhatsapp, mensajeDeReserva } from "./whatsapp";

export type DependenciasCrear = {
  leerConfig: () => Promise<Configuracion>;
  verificarImagen: (entrada: { ruta: unknown; usuario: Pick<Usuario, "id" | "rol"> }) => Promise<ImagenVerificada>;
  // Base de la transacción de escritura. En producción es la de Neon; las pruebas contra la rama usan la suya.
  base: () => Pick<BaseDatos, "transaction">;
  // Equipos candidatos en orden. Sin esto se leen los activos dentro de la transacción (las pruebas pasan los suyos).
  equipoIds?: number[];
  numeroWhatsapp: () => string | null;
};

const porDefecto: DependenciasCrear = {
  leerConfig: () => leerConfiguracion(),
  verificarImagen: (entrada) => verificarImagenSubida(entrada),
  base: () => db(),
  numeroWhatsapp: () => leerEnvWhatsapp().WHATSAPP_NUMERO,
};

export const MENSAJE_MEMBRESIA_EN_REVISION =
  "Tu pago de la membresía está en revisión. Cuando se apruebe, podrás elegir un nuevo día y hora desde tu perfil.";
export const MENSAJE_YA_ES_MIEMBRO = "Ya eres miembro de Tiza Club. Reserva tu limpieza desde tu perfil.";

type ServicioRespuesta =
  | { tipo: "estandar" | "profunda" | "mudanza"; dormitorios: number; banos: number }
  | { tipo: "paquete"; horas: number };

export type RespuestaReserva = {
  reserva: {
    id: string;
    estado: string;
    servicio: ServicioRespuesta;
    inicio: string;
    fin: string;
    expira_en: string | null;
    monto: number;
    precio_lista: number;
    horas_gratis_aplicadas: number;
    requiere_apoyo: boolean;
  };
  membresia: { id: string; estado: string; monto: number };
  pago: { id: string; concepto: string; monto: number; metodo: string; estado: string };
  whatsapp: string | null;
};

// La reserva de un miembro no crea ninguna membresía: `membresia` es null.
export type RespuestaReservaMiembro = Omit<RespuestaReserva, "membresia"> & { membresia: null };
// Lo que devuelve POST /api/reservas según la rama.
export type RespuestaDeReserva = RespuestaReserva | RespuestaReservaMiembro;

// Crea, en una sola transacción, la membresía pendiente, el pago pendiente y la reserva pendiente del cliente nuevo
// (design 9a, decisión 4). Lo que puede fallar sin tocar la base se valida ANTES de abrir la transacción.
export async function crearPrimeraReserva(
  { usuario, cuerpo, ahora }: { usuario: Usuario; cuerpo: unknown; ahora: Date },
  dependencias: DependenciasCrear = porDefecto,
): Promise<RespuestaReserva> {
  // --- Fuera de la transacción ---
  const datos = validar(esquemaReserva, cuerpo);
  const direccion = validarDireccion(datos.direccion);
  const imagen = await dependencias.verificarImagen({ ruta: datos.comprobante, usuario: { id: usuario.id, rol: usuario.rol } });
  const config = await dependencias.leerConfig();
  const zona = config.horario_atencion.zona;

  const inicio = new Date(datos.inicio);
  // Las horas de agenda no dependen de las horas gratis: se calculan una vez para validar el horario.
  const { horas_agenda: horasAgendaPrevias } = calcularServicio(config, datos.servicio);
  validarInicioServicio(config, ahora, inicio, horasAgendaPrevias);
  validarVigenciaPrimeraMembresia(config, ahora, inicio);

  const montoMembresia = config.membresia_precio_mensual * config.membresia_meses;

  // --- Dentro de la transacción (expira las vencidas antes de leer los límites del cliente) ---
  let guardado: { reserva: typeof reservas.$inferSelect; membresia: typeof membresias.$inferSelect; pago: typeof pagos.$inferSelect };
  try {
    guardado = await transaccionDeEscritura(async (tx: Transaccion) => {
      // Quien pasó el plazo para reenviar su comprobante puede empezar de nuevo: se cierra su membresía en esta misma
      // petición, sin esperar a que el administrador abra su portal (design de revision-de-pagos-admin, decisión 4).
      await cerrarMembresiasSinReenvio(tx, config.reenvio_comprobante_dias);
      await comprobarEstadoDelCliente(tx, usuario.id, config);

      const gratis = await decidirLimpiezaGratis(tx, usuario.id, claveHogar(direccion));
      const calculo = calcularServicio(config, { ...datos.servicio, aplicaGratis: gratis });
      const rango = rangoBloqueado(config, inicio, calculo.horas_agenda);

      const [membresia] = await tx
        .insert(membresias)
        .values({ usuarioId: usuario.id, monto: montoMembresia, estado: "pendiente" })
        .returning();
      const [pago] = await tx
        .insert(pagos)
        .values({
          usuarioId: usuario.id,
          concepto: calculo.monto > 0 ? "membresia_y_reserva" : "membresia",
          membresiaId: membresia.id,
          monto: montoMembresia + calculo.monto,
          metodo: datos.metodo,
          comprobanteRuta: imagen.ruta,
          estado: "pendiente",
        })
        .returning();

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
        estado: "pendiente",
        // El plazo se fija con el reloj de la base, igual que `reservaActiva` y `expirarVencidas`.
        expiraEn: sql`now() + make_interval(hours => ${config.espera_pago_horas}::int)`,
      };
      const reserva = await insertarEnPrimerEquipoLibre(tx, candidatos, fila);
      return { reserva, membresia, pago };
    }, dependencias.base());
  } catch (error) {
    throw traducirUnicidad(error);
  }

  // --- Fuera, después del commit ---
  const { reserva, membresia, pago } = guardado;
  const mensaje = mensajeDeReserva({
    estado: "pendiente",
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
      servicio: datos.servicio.tipo === "paquete" ? { tipo: "paquete", horas: datos.servicio.horas } : datos.servicio,
      inicio: isoConZona(reserva.inicio, zona),
      fin: isoConZona(reserva.fin, zona),
      expira_en: reserva.expiraEn ? isoConZona(reserva.expiraEn, zona) : null,
      monto: reserva.monto,
      precio_lista: reserva.precioLista,
      horas_gratis_aplicadas: Number(reserva.horasGratisAplicadas),
      requiere_apoyo: reserva.requiereApoyo,
    },
    membresia: { id: membresia.id, estado: membresia.estado, monto: membresia.monto },
    pago: { id: pago.id, concepto: pago.concepto, monto: pago.monto, metodo: pago.metodo, estado: pago.estado },
    whatsapp: enlaceWhatsapp({ numero: dependencias.numeroWhatsapp(), mensaje }),
  };
}

export type DependenciasReserva = DependenciasMiembro & {
  // ¿Tiene el cliente alguna membresía `activa` (vigente o vencida)? Decide la rama. Las pruebas de ruta pasan la suya.
  esMiembro?: (usuarioId: string) => Promise<boolean>;
};

// Punto de entrada de POST /api/reservas (reservar-como-miembro-activo, decisión 1). Quien tiene una membresía `activa`,
// aunque ya haya vencido, es un miembro: reserva con descuento y, si su membresía venció, recibe el 422 de renovar. Quien
// no la tiene sigue el flujo de la primera membresía sin cambios. Si la membresía se activa entre esta lectura y la
// transacción de la primera rama, `comprobarEstadoDelCliente` responde 409 en vez de crear una segunda membresía.
export async function crearReserva(
  entrada: { usuario: Usuario; cuerpo: unknown; ahora: Date },
  dependencias: DependenciasReserva = porDefecto,
): Promise<RespuestaDeReserva> {
  const esMiembro = dependencias.esMiembro ?? ((usuarioId: string) => tieneMembresiaActiva(db(), usuarioId));
  if (await esMiembro(entrada.usuario.id)) return crearReservaDeMiembro(entrada, dependencias);
  return crearPrimeraReserva(entrada, dependencias);
}

// 409 con el código `en_espera` (distinto del `conflicto` de la falta de cupo). Primero la reserva en espera:
// es el mensaje que pide TECH-DESIGN.md. Este flujo es solo para quien todavía no tiene ninguna membresía; la
// reserva de un miembro con descuento la construye el ítem #13 sobre esta misma ruta. Una membresía `caducada` (plazo de
// reenvío vencido) no cuenta: el cliente empieza de nuevo. Con una `pendiente` se distingue si su último pago está en
// revisión (`en_espera`) o rechazado dentro del plazo (`pago_rechazado`, con la fecha límite).
async function comprobarEstadoDelCliente(
  tx: Pick<Transaccion, "select">,
  usuarioId: string,
  config: Pick<Configuracion, "reenvio_comprobante_dias" | "horario_atencion">,
) {
  const enEspera = await tx
    .select({ id: reservas.id })
    .from(reservas)
    .where(and(eq(reservas.usuarioId, usuarioId), eq(reservas.estado, "pendiente")))
    .limit(1);
  if (enEspera.length > 0) throw new ErrorApi(409, "en_espera", MENSAJE_RESERVA_EN_ESPERA);

  const todas = await tx.select({ id: membresias.id, estado: membresias.estado }).from(membresias).where(eq(membresias.usuarioId, usuarioId));
  const existentes = todas.filter((m) => m.estado !== "caducada");
  if (existentes.some((m) => m.estado === "activa")) throw new ErrorApi(409, "en_espera", MENSAJE_YA_ES_MIEMBRO);
  const pendiente = existentes.find((m) => m.estado === "pendiente");
  if (!pendiente) return;

  const [ultimoPago] = await tx
    .select({ estado: pagos.estado, reenvioHasta: reenvioHastaSql(config.reenvio_comprobante_dias) })
    .from(pagos)
    .where(eq(pagos.membresiaId, pendiente.id))
    .orderBy(desc(pagos.creadoEn))
    .limit(1);
  if (ultimoPago?.estado === "rechazado" && ultimoPago.reenvioHasta) {
    throw new ErrorApi(409, "pago_rechazado", mensajePagoRechazado(new Date(ultimoPago.reenvioHasta), config.horario_atencion.zona));
  }
  throw new ErrorApi(409, "en_espera", MENSAJE_MEMBRESIA_EN_REVISION);
}

export function mensajePagoRechazado(limite: Date, zona: string): string {
  const fecha = new Intl.DateTimeFormat("es-PE", { timeZone: zona, day: "numeric", month: "long", year: "numeric" }).format(limite);
  return `Tu comprobante fue rechazado. Sube otro comprobante desde tu perfil antes del ${fecha}.`;
}

async function equiposActivos(tx: Pick<Transaccion, "select">): Promise<number[]> {
  const filas = await tx.select({ id: equipos.id }).from(equipos).where(eq(equipos.activo, true)).orderBy(equipos.id);
  return filas.map((f) => f.id);
}
