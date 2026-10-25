import { eq, sql } from "drizzle-orm";
import { db } from "@/db/cliente";
import { fotosServicio, reservas } from "@/db/esquema";
import { transaccionDeEscritura, type BaseDatos } from "../agenda/expirar";
import { leerConfiguracion } from "../configuracion";
import { ErrorApi } from "../errores";
import { verificarImagenSubida } from "../imagenes/verificar";
import { esUuid } from "../uuid";
import { validar } from "../validacion-sesion";
import { MENSAJE_RESERVA_NO_ENCONTRADA } from "../admin/reservas/completar";
import { NOMBRE_DEL_ESTADO, type EstadoEfectivo } from "../admin/reservas/estado";
import { crearEsquemaFotos } from "./esquema-entrada";

export const MENSAJE_YA_REGISTRADAS = "Esas fotos ya estaban registradas.";
export const MENSAJE_REPETIDAS = "Hay fotos repetidas en el envío.";
export const MENSAJE_OTRA_RESERVA = "Esa foto no corresponde a esta reserva. Súbela desde la pantalla de la reserva.";
const POR_VERIFICACION_EN_PARALELO = 3;

export type FotoRegistrada = { id: string; ambiente: string };

export type DependenciasRegistrar = {
  // Lectura previa del estado, sin transacción ni Blob.
  base: () => Pick<BaseDatos, "select">;
  transaccion: typeof transaccionDeEscritura;
  baseDeEscritura: () => Pick<BaseDatos, "transaction">;
  verificar: typeof verificarImagenSubida;
  leerLimite: () => Promise<number>;
};

const porDefecto: DependenciasRegistrar = {
  base: () => db(),
  transaccion: transaccionDeEscritura,
  baseDeEscritura: () => db(),
  verificar: verificarImagenSubida,
  leerLimite: async () => (await leerConfiguracion()).fotos_maximas_por_reserva,
};

const mensajeDeEstado = (estado: EstadoEfectivo) =>
  `Solo puedes subir fotos de una limpieza completada. Esa reserva está ${NOMBRE_DEL_ESTADO[estado]}.`;

const codigoDe = (valor: unknown): unknown => (typeof valor === "object" && valor !== null ? (valor as { code?: unknown }).code : undefined);
// Drizzle envuelve el error de Postgres; el SQLSTATE queda en `cause`.
const esRutaRepetida = (error: unknown) =>
  codigoDe(error) === "23505" || codigoDe(typeof error === "object" && error !== null ? (error as { cause?: unknown }).cause : undefined) === "23505";

// Verifica de a pocas a la vez; si alguna falla, devuelve el error de la PRIMERA en el orden del envío y no se escribe nada.
async function verificarTodas(
  rutas: string[],
  usuario: { id: string; rol: "cliente" | "admin" },
  verificar: DependenciasRegistrar["verificar"],
): Promise<string[]> {
  const verificadas: string[] = [];
  for (let i = 0; i < rutas.length; i += POR_VERIFICACION_EN_PARALELO) {
    const lote = rutas.slice(i, i + POR_VERIFICACION_EN_PARALELO);
    const resultados = await Promise.allSettled(lote.map((ruta) => verificar({ ruta, usuario })));
    const fallo = resultados.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (fallo) throw fallo.reason;
    for (const r of resultados) verificadas.push((r as PromiseFulfilledResult<Awaited<ReturnType<typeof verificarImagenSubida>>>).value.ruta);
  }
  return verificadas;
}

// Registra las fotos del servicio de una reserva `completada` (PRD, alcance 9). Orden (design de fotos-del-servicio, decisión 2):
//  1) el cuerpo (422); 2) lectura previa del estado, SIN tocar Blob: 404 si no existe, 409 si no está completada, así una reserva
//  que no sirve no gasta llamadas a Blob; 3) verificación de cada archivo (existe, ≤ 4 MB, bytes de imagen) FUERA de la transacción
//  (ADR 0010) y de su carpeta; 4) transacción: fila de la reserva bloqueada, el estado otra vez, el conteo contra el límite e
//  inserción de todas. Todo o nada: si una falla no se guarda ninguna, ni las válidas del mismo envío.
//
// Decisión 3: `validarRutaSubida` (de #8) solo prueba que un administrador use una carpeta `fotos/<id válido>/`, no que ese id sea
// el de la reserva de la URL. Esa comparación se hace aquí, sobre la ruta que DEVUELVE la verificación (nunca sobre lo que envió
// el navegador), y solo esa ruta se guarda. Un archivo de otra reserva se rechaza con 422.
//
// El estado se comprueba dos veces a propósito: la lectura previa es barata y evita Blob; la del bloqueo (`FOR UPDATE`) es la
// garantía real, y en la misma sección crítica se cuenta contra el límite, de modo que dos envíos simultáneos no lo superen.
//
// Reintento: si el primer intento se confirmó y la conexión se cortó en el COMMIT, el segundo choca con la ruta única (23505) y
// responde 409, que es verdad y no duplica nada.
export async function registrarFotos(
  { usuario, reservaId, cuerpo }: { usuario: { id: string; rol: "cliente" | "admin" }; reservaId: string; cuerpo: unknown },
  dependencias: DependenciasRegistrar = porDefecto,
): Promise<FotoRegistrada[]> {
  if (!esUuid(reservaId)) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
  const id = reservaId.toLowerCase();

  const limite = await dependencias.leerLimite();
  const { fotos } = validar(crearEsquemaFotos(limite), cuerpo);
  if (new Set(fotos.map((f) => f.ruta)).size !== fotos.length) throw ErrorApi.invalido(MENSAJE_REPETIDAS);

  const [previa] = await dependencias.base().select({ estado: reservas.estado }).from(reservas).where(eq(reservas.id, id)).limit(1);
  if (!previa) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
  if (previa.estado !== "completada") throw ErrorApi.conflicto(mensajeDeEstado(previa.estado));

  const rutasVerificadas = await verificarTodas(
    fotos.map((f) => f.ruta),
    usuario,
    dependencias.verificar,
  );
  if (rutasVerificadas.some((ruta) => !ruta.startsWith(`fotos/${id}/`))) throw ErrorApi.invalido(MENSAJE_OTRA_RESERVA);

  try {
    return await dependencias.transaccion(async (tx) => {
      const [reserva] = await tx.select({ estado: reservas.estado }).from(reservas).where(eq(reservas.id, id)).for("update");
      if (!reserva) throw ErrorApi.noEncontrado(MENSAJE_RESERVA_NO_ENCONTRADA);
      if (reserva.estado !== "completada") throw ErrorApi.conflicto(mensajeDeEstado(reserva.estado));

      const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(fotosServicio).where(eq(fotosServicio.reservaId, id));
      const existentes = Number(total);
      if (existentes + fotos.length > limite) {
        const caben = Math.max(0, limite - existentes);
        throw ErrorApi.conflicto(
          caben === 0
            ? `Esta reserva ya llegó al máximo de ${limite} fotos.`
            : `Esta reserva tiene ${existentes} de ${limite} fotos: solo caben ${caben} más. No se registró ninguna.`,
        );
      }

      return tx
        .insert(fotosServicio)
        .values(fotos.map((f, i) => ({ reservaId: id, ambiente: f.ambiente, ruta: rutasVerificadas[i], subidaPor: usuario.id })))
        .returning({ id: fotosServicio.id, ambiente: fotosServicio.ambiente });
    }, dependencias.baseDeEscritura());
  } catch (error) {
    if (esRutaRepetida(error)) throw ErrorApi.conflicto(MENSAJE_YA_REGISTRADAS);
    throw error;
  }
}
