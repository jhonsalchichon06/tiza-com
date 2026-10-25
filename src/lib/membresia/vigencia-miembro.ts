import type { BaseDatos } from "../agenda/expirar";
import { instanteLocal, validarFecha } from "../agenda/horario";
import type { Configuracion } from "../configuracion";
import { ErrorApi } from "../errores";
import { pagosRechazadosReenviables } from "../pagos/reenvio-plazo";
import { leerMembresiaDelCliente, type PagoReenviable } from "../perfil/membresia";
import { formatearFecha } from "../perfil/textos";
import { leerMembresiaQueAutoriza } from "../reservas/membresia-vigente";
import { validarVigenciaDeMembresia } from "../reservas/vigencia";
import { renovacionPendiente } from "./renovacion";

// Guard de vigencia para elegir día y hora (renovacion-del-mes-4, decisión 5; PRD, caso borde 6).
//
//   comprobarVigenciaParaReservar(base, usuarioId, inicioServicio, config) → ResultadoDeVigencia
//   aErrorApi(resultado, zona) → ErrorApi | null
//
// Códigos: `membresia_vencida` 409, `renovacion_en_revision` 409 y `fuera_de_vigencia` 422. `sin_membresia` es un cliente
// que nunca fue miembro: el guard no lo bloquea (lo atiende el flujo de la primera membresía, #9a).
//
// La comparación `inicio < fin` (un servicio que empieza justo en el `fin` no es vigente, ADR 0008) NO se escribe aquí: es la de
// `validarVigenciaDeMembresia` del ítem 13 (`src/lib/reservas/vigencia.ts`), única en el código. Este guard solo clasifica lo
// que #13 no distingue: membresía vencida y renovación en revisión. No lee `creditos_horas`: el saldo de crédito en horas
// se ve en el perfil pero no levanta el bloqueo (TECH-DESIGN.md). Reloj: `vigente` sale de `fin > now()` en SQL.

export type ResultadoDeVigencia =
  | { tipo: "ok"; fin: Date }
  | { tipo: "sin_membresia" }
  | { tipo: "membresia_vencida"; fin: Date }
  | { tipo: "renovacion_en_revision"; fin: Date }
  | { tipo: "fuera_de_vigencia"; fin: Date };

type Lector = Pick<BaseDatos, "select">;
export type ConfigDeVigencia = Pick<Configuracion, "horario_atencion" | "reenvio_comprobante_dias">;

export async function comprobarVigenciaParaReservar(
  base: Lector,
  usuarioId: string,
  inicioServicio: Date,
  config: ConfigDeVigencia,
): Promise<ResultadoDeVigencia> {
  const membresia = await leerMembresiaQueAutoriza(base, usuarioId);
  if (!membresia) return { tipo: "sin_membresia" };

  if (!membresia.vigente) {
    const filas = await leerMembresiaDelCliente(base, usuarioId);
    const crudos = await pagosRechazadosReenviables(base, usuarioId, config);
    const reenviables: PagoReenviable[] = crudos.map((r) => ({ pagoId: r.pagoId, reenvioHasta: new Date(r.reenvioHasta), motivoRechazo: r.motivoRechazo }));
    const pendiente = renovacionPendiente(filas, reenviables);
    // Una renovación rechazada dentro del plazo también espera: el cliente sube otro comprobante desde el perfil.
    return pendiente.tipo === "ninguna" ? { tipo: "membresia_vencida", fin: membresia.fin } : { tipo: "renovacion_en_revision", fin: membresia.fin };
  }

  try {
    validarVigenciaDeMembresia(config, membresia.fin, inicioServicio);
  } catch (error) {
    if (error instanceof ErrorApi && error.status === 422) return { tipo: "fuera_de_vigencia", fin: membresia.fin };
    throw error;
  }
  return { tipo: "ok", fin: membresia.fin };
}

// Traduce el resultado a error de la API (`null` si el cliente puede seguir). Las fechas salen en la zona de `horario_atencion`.
export function aErrorApi(resultado: ResultadoDeVigencia, zona: string): ErrorApi | null {
  switch (resultado.tipo) {
    case "ok":
    case "sin_membresia":
      return null;
    case "membresia_vencida":
      return new ErrorApi(409, "membresia_vencida", `Tu membresía venció el ${formatearFecha(resultado.fin, zona)}. Realiza un nuevo pago para seguir reservando.`);
    case "renovacion_en_revision":
      return new ErrorApi(409, "renovacion_en_revision", "Tu pago de renovación está en revisión. Cuando se apruebe, podrás elegir día y hora.");
    case "fuera_de_vigencia":
      return new ErrorApi(422, "fuera_de_vigencia", `Tu membresía vence el ${formatearFecha(resultado.fin, zona)}. Elige una fecha anterior o renueva cuando venza.`);
  }
}

// Para `GET /api/disponibilidad`: la consulta recibe un día, no una hora. Se rechaza el día completo (su primera hora de
// atención cae en o después del `fin`); un día que contiene el `fin` en mitad del horario muestra todos sus horarios y la
// reserva (#13) rechaza el que lo supere con la misma comparación. Solo bloquea a quien ya tiene una membresía `activa`.
export async function comprobarVigenciaDeLaConsulta({
  base,
  usuarioId,
  fecha,
  config,
}: {
  base: Lector;
  usuarioId: string;
  fecha: unknown;
  config: ConfigDeVigencia;
}): Promise<void> {
  const dia = validarFecha(fecha);
  const { zona, apertura } = config.horario_atencion;
  const resultado = await comprobarVigenciaParaReservar(base, usuarioId, instanteLocal(dia, apertura, zona), config);
  const error = aErrorApi(resultado, zona);
  if (error) throw error;
}
