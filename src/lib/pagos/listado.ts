import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { membresias, pagos, reservas, usuarios } from "@/db/esquema";
import type { BaseDatos } from "../agenda/expirar";
import { isoConZona } from "../agenda/horario";
import type { Configuracion } from "../configuracion";
import { ErrorApi } from "../errores";
import { esUuid } from "../uuid";
import { validar } from "../validacion-sesion";
import { buscarCoincidencias, type Coincidencia } from "./coincidencias";
import { reenvioHastaSql, reenvioVigenteSql } from "./plazo";

export const LIMITE_DE_LISTA = 100;
export const MENSAJE_ESTADO_INVALIDO = "El estado debe ser pendiente, aprobado o rechazado.";

const esquemaEstado = z.enum(["pendiente", "aprobado", "rechazado"], { error: MENSAJE_ESTADO_INVALIDO });
export type EstadoDePago = z.infer<typeof esquemaEstado>;

type ConfigListado = Pick<Configuracion, "reenvio_comprobante_dias" | "horario_atencion">;
type Lector = Pick<BaseDatos, "select">;

// Una reserva vencida sin marcar nunca se muestra como pendiente (ADR 0009): el estado efectivo se calcula con la misma
// condición que `reservaActiva`, con el reloj de la base.
const estadoEfectivoDeReserva = sql<string | null>`CASE WHEN ${reservas.estado} = 'pendiente' AND ${reservas.expiraEn} <= now() THEN 'expirada' ELSE ${reservas.estado} END`;
// Vencimiento de la reserva viva (solo una pendiente vigente espera algo): el orden de la lista.
const vencimientoVivo = sql`CASE WHEN ${reservas.estado} = 'pendiente' AND ${reservas.expiraEn} > now() THEN ${reservas.expiraEn} END`;

// De las reservas de un pago (puede haber varias a lo largo del tiempo) se muestra la más reciente.
const reservaVinculada = sql`${reservas.id} = (SELECT r.id FROM reservas r WHERE r.pago_id = ${pagos.id} ORDER BY r.creada_en DESC LIMIT 1)`;

// Horas de crédito de la reserva que ya no están tomadas de ningún lote (ítem 14, decisión 4): solo una reserva viva puede tener
// faltante; las expiradas y canceladas devolvieron todo y su crédito aplicado no cuenta. Se calcula al leer, no se guarda.
const creditoFaltante = sql<string | null>`CASE WHEN ${reservas.estado} IN ('confirmada', 'completada') THEN GREATEST(0, ${reservas.creditoAplicado} - COALESCE((SELECT SUM(u.horas) FROM usos_credito u WHERE u.reserva_destino_id = ${reservas.id} AND u.estado <> 'devuelto'), 0)) END`;

function seleccionarPagos(base: Lector, config: ConfigListado) {
  const dias = config.reenvio_comprobante_dias;
  return base
    .select({
      id: pagos.id,
      concepto: pagos.concepto,
      monto: pagos.monto,
      metodo: pagos.metodo,
      estado: pagos.estado,
      creadoEn: pagos.creadoEn,
      revisadoEn: pagos.revisadoEn,
      motivoRechazo: pagos.motivoRechazo,
      reemplazaA: pagos.reemplazaA,
      // Solo los pagos rechazados tienen plazo de reenvío; los demás, null.
      reenvioHasta: sql<string | null>`CASE WHEN ${pagos.estado} = 'rechazado' THEN ${reenvioHastaSql(dias)} END`,
      reenvioVigente: sql<boolean | null>`CASE WHEN ${pagos.estado} = 'rechazado' THEN ${reenvioVigenteSql(dias)} END`,
      clienteId: usuarios.id,
      clienteNombre: usuarios.name,
      clienteCorreo: usuarios.email,
      clienteCelular: usuarios.telefono,
      membresiaId: membresias.id,
      membresiaEstado: membresias.estado,
      reservaId: reservas.id,
      reservaEstado: estadoEfectivoDeReserva,
      reservaExpiraEn: reservas.expiraEn,
      reservaInicio: reservas.inicio,
      reservaTipo: reservas.tipo,
      reservaDistrito: reservas.distrito,
      reservaCalle: reservas.calle,
      reservaNumero: reservas.numero,
      reservaDepartamento: reservas.departamento,
      reservaMonto: reservas.monto,
      reservaPrimeraGratis: reservas.primeraGratis,
      reservaHorasGratis: reservas.horasGratisAplicadas,
      reservaCreditoFaltante: creditoFaltante,
    })
    .from(pagos)
    .innerJoin(usuarios, eq(usuarios.id, pagos.usuarioId))
    .leftJoin(membresias, eq(membresias.id, pagos.membresiaId))
    .leftJoin(reservas, reservaVinculada);
}

type FilaDePago = Awaited<ReturnType<ReturnType<typeof seleccionarPagos>["limit"]>>[number];

export type ElementoDePago = {
  pago: {
    id: string;
    concepto: string;
    monto: number;
    metodo: string;
    estado: string;
    creado_en: string;
    revisado_en: string | null;
    motivo_rechazo: string | null;
    reemplaza_a: string | null;
    reenvio_hasta: string | null;
    reenvio_vigente: boolean | null;
  };
  cliente: { id: string; nombre: string; correo: string; celular: string };
  membresia: { id: string; estado: string } | null;
  reserva: {
    id: string;
    estado: string | null;
    expira_en: string | null;
    inicio: string;
    tipo: string;
    distrito: string;
    calle: string;
    numero: string;
    departamento: string | null;
    monto: number;
    primera_gratis: boolean;
    horas_gratis_aplicadas: number;
    // Horas de crédito que la reserva debía tener y no pudo tomar (nuevo horario tras una aprobación tardía): casi siempre 0.
    credito_faltante_horas: number;
  } | null;
  comprobante: string;
};

const hasta = (valor: string | null, zona: string) => (valor ? isoConZona(new Date(valor), zona) : null);

export function aElementoDePago(f: FilaDePago, zona: string): ElementoDePago {
  return {
    pago: {
      id: f.id,
      concepto: f.concepto,
      monto: f.monto,
      metodo: f.metodo,
      estado: f.estado,
      creado_en: isoConZona(f.creadoEn, zona),
      revisado_en: f.revisadoEn ? isoConZona(f.revisadoEn, zona) : null,
      motivo_rechazo: f.motivoRechazo,
      reemplaza_a: f.reemplazaA,
      reenvio_hasta: hasta(f.reenvioHasta, zona),
      reenvio_vigente: f.reenvioVigente === null ? null : Boolean(f.reenvioVigente),
    },
    cliente: { id: f.clienteId, nombre: f.clienteNombre, correo: f.clienteCorreo, celular: f.clienteCelular },
    membresia: f.membresiaId ? { id: f.membresiaId, estado: f.membresiaEstado! } : null,
    reserva: f.reservaId
      ? {
          id: f.reservaId,
          estado: f.reservaEstado,
          expira_en: f.reservaExpiraEn ? isoConZona(f.reservaExpiraEn, zona) : null,
          inicio: isoConZona(f.reservaInicio!, zona),
          tipo: f.reservaTipo!,
          distrito: f.reservaDistrito!,
          calle: f.reservaCalle!,
          numero: f.reservaNumero!,
          departamento: f.reservaDepartamento,
          monto: f.reservaMonto!,
          primera_gratis: Boolean(f.reservaPrimeraGratis),
          horas_gratis_aplicadas: Number(f.reservaHorasGratis ?? 0),
          credito_faltante_horas: Number(f.reservaCreditoFaltante ?? 0),
        }
      : null,
    comprobante: `/api/comprobantes/${f.id}`,
  };
}

// Pagos del estado pedido (`pendiente` por defecto), con su cliente, su membresía y su reserva vinculada, máximo 100.
// Los pendientes van primero por el vencimiento más próximo de su reserva viva y luego por antigüedad (los que ya no
// tienen reserva viva, al final); los revisados, del más reciente al más antiguo.
export async function listarPagos(
  base: Lector,
  { estado }: { estado?: string | null },
  config: ConfigListado,
): Promise<ElementoDePago[]> {
  const pedido = validar(esquemaEstado, estado ?? "pendiente");
  const orden = pedido === "pendiente" ? [sql`${vencimientoVivo} ASC NULLS LAST`, asc(pagos.creadoEn)] : [sql`${pagos.revisadoEn} DESC NULLS LAST`, desc(pagos.creadoEn)];
  const filas = await seleccionarPagos(base, config)
    .where(eq(pagos.estado, pedido))
    .orderBy(...orden)
    .limit(LIMITE_DE_LISTA);
  return filas.map((f) => aElementoDePago(f, config.horario_atencion.zona));
}

export type DetalleDePago = ElementoDePago & {
  coincidencias: { aplica: boolean; lista: (Omit<Coincidencia, "inicio"> & { inicio: string })[] };
};

// El mismo elemento más las coincidencias de dirección. 404 si el id no tiene formato de uuid o no existe.
export async function detalleDePago(base: Lector, id: string, config: ConfigListado): Promise<DetalleDePago> {
  if (!esUuid(id)) throw ErrorApi.noEncontrado("No encontramos ese pago.");
  const [fila] = await seleccionarPagos(base, config).where(and(eq(pagos.id, id))).limit(1);
  if (!fila) throw ErrorApi.noEncontrado("No encontramos ese pago.");
  const { aplica, coincidencias } = await buscarCoincidencias(base, fila.membresiaId);
  const zona = config.horario_atencion.zona;
  return {
    ...aElementoDePago(fila, zona),
    coincidencias: { aplica, lista: coincidencias.map((c) => ({ ...c, inicio: isoConZona(c.inicio, zona) })) },
  };
}
