import { z } from "zod";
import { db } from "@/db/cliente";
import { configuracion as tablaConfiguracion } from "@/db/esquema";

// Montos en céntimos enteros (S/ 193,50 = 19350) para no arrastrar errores de redondeo.
const centimos = z.number().int().nonnegative();
const horas = z.number().positive().multipleOf(0.5);
const porTipo = <T extends z.ZodType>(valor: T) =>
  z.object({ estandar: valor, profunda: valor, mudanza: valor });
const horaDelDia = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
// `null` = sin máximo (último nivel del hogar).
const maximo = z.number().int().nonnegative().nullable();

// Un esquema por clave de la tabla `configuracion` (ADR 0008).
const esquemas = {
  niveles_hogar: z
    .array(z.object({ max_dormitorios: maximo, max_banos: maximo, horas }))
    .min(1),
  precios_niveles: z.array(centimos).min(1),
  horas_extra_tipo: porTipo(z.number().nonnegative().multipleOf(0.5)),
  multiplicadores_precio: porTipo(z.number().positive()),
  paquetes_horas: z.array(z.object({ horas, precio: centimos })).min(1),
  apoyo_extra: z.object({ umbral_horas: horas, factor_agenda: z.number().gt(0).lte(1) }),
  membresia_precio_mensual: centimos,
  membresia_meses: z.number().int().positive(),
  horas_gratis: z.number().nonnegative().multipleOf(0.5),
  descuento_miembro: z.number().min(0).lt(1),
  anticipacion_minima_horas: z.number().int().nonnegative(),
  espera_pago_horas: z.number().int().positive(),
  traslado_horas: z.number().nonnegative().multipleOf(0.5),
  intervalo_horarios_minutos: z.number().int().positive(),
  credito_vence_meses: z.number().int().positive(),
  // Días para subir otro comprobante tras un rechazo, contados desde `pagos.revisado_en` (PRD, caso borde 1).
  // Decidido por el usuario (no provisional); pasado el plazo, la membresía pendiente pasa a `caducada`.
  reenvio_comprobante_dias: z.number().int().positive(),
  // Horas mínimas antes del servicio para cancelar o reprogramar (PRD, alcance punto 7: "hasta 24 horas antes"). No provisional.
  cancelacion_minima_horas: z.number().int().positive(),
  // Días antes del fin de la membresía en que el perfil avisa que vence (renovacion-del-mes-4). Provisional: el PRD no fija la ventana.
  renovacion_aviso_dias: z.number().int().positive(),
  // Máximo de fotos del servicio por reserva (fotos-del-servicio). Provisional: el PRD no fija un número; el valor 12 es un supuesto.
  fotos_maximas_por_reserva: z.number().int().positive(),
  horario_atencion: z.object({
    dias: z.array(z.number().int().min(0).max(6)).min(1), // 0 = domingo
    apertura: horaDelDia,
    cierre: horaDelDia,
    zona: z.string().min(1),
  }),
};

export type ClaveConfiguracion = keyof typeof esquemas;
export type Configuracion = { [K in ClaveConfiguracion]: z.infer<(typeof esquemas)[K]> };

export const CLAVES_CONFIGURACION = Object.keys(esquemas) as ClaveConfiguracion[];

export function esClaveConfiguracion(clave: string): clave is ClaveConfiguracion {
  return Object.hasOwn(esquemas, clave);
}

// Valida el valor guardado de un parámetro; si no tiene la forma esperada, el error nombra la clave.
export function validarParametro<K extends ClaveConfiguracion>(clave: K, valor: unknown): Configuracion[K] {
  if (!esClaveConfiguracion(clave)) {
    throw new Error(`Parámetro de configuración desconocido: ${String(clave)}`);
  }
  const resultado = esquemas[clave].safeParse(valor);
  if (resultado.success) return resultado.data as Configuracion[K];
  const detalle = resultado.error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
  throw new Error(`Parámetro de configuración inválido: ${clave} (${detalle})`);
}

type Fila = { clave: string; valor: unknown };
type Consulta = () => Promise<Fila[]>;

const consultarTabla: Consulta = () =>
  db().select({ clave: tablaConfiguracion.clave, valor: tablaConfiguracion.valor }).from(tablaConfiguracion);

// Lee todos los parámetros en una consulta y valida cada uno. Sin caché ni valores por defecto:
// un parámetro faltante o inválido es un error que lo nombra.
export async function leerConfiguracion(consultar: Consulta = consultarTabla): Promise<Configuracion> {
  const filas = new Map((await consultar()).map((f) => [f.clave, f.valor]));
  const faltan = CLAVES_CONFIGURACION.filter((clave) => !filas.has(clave));
  if (faltan.length) {
    throw new Error(`Falta el parámetro de configuración: ${faltan.join(", ")}`);
  }
  const valores = Object.fromEntries(
    CLAVES_CONFIGURACION.map((clave) => [clave, validarParametro(clave, filas.get(clave))]),
  ) as Configuracion;
  if (valores.precios_niveles.length !== valores.niveles_hogar.length) {
    throw new Error(
      "Parámetro de configuración inválido: precios_niveles debe tener un precio por cada nivel de niveles_hogar",
    );
  }
  return valores;
}
