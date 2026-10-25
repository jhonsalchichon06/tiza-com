import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/cliente";
import { membresias, pagos, reservas } from "@/db/esquema";
import { transaccionDeEscritura, type BaseDatos } from "../agenda/expirar";
import { isoConZona } from "../agenda/horario";
import { leerConfiguracion, type Configuracion } from "../configuracion";
import { ErrorApi } from "../errores";
import { verificarImagenSubida, type ImagenVerificada } from "../imagenes/verificar";
import { traducirUnicidad } from "../reservas/unicidad";
import type { Usuario } from "../sesion";
import { validar } from "../validacion-sesion";
import { esUuid } from "../uuid";
import { reenvioVigenteSql } from "./plazo";

export type DependenciasReenvio = {
  leerConfig: () => Promise<Pick<Configuracion, "reenvio_comprobante_dias" | "horario_atencion">>;
  verificarImagen: (entrada: { ruta: unknown; usuario: Pick<Usuario, "id" | "rol"> }) => Promise<ImagenVerificada>;
  base: () => Pick<BaseDatos, "transaction">;
};

const porDefecto: DependenciasReenvio = {
  leerConfig: () => leerConfiguracion(),
  verificarImagen: (entrada) => verificarImagenSubida(entrada),
  base: () => db(),
};

export const MENSAJE_PAGO_NO_ENCONTRADO = "No encontramos ese pago.";
export const MENSAJE_PAGO_NO_RECHAZADO = "Ese pago no está rechazado, así que no puedes subir otro comprobante.";
export const MENSAJE_PLAZO_VENCIDO = "Pasó el plazo para subir otro comprobante. Puedes empezar de nuevo con una reserva y un pago nuevos.";
export const MENSAJE_COMPROBANTE_EN_REVISION = "Ya tienes un comprobante en revisión.";

// Cuerpo de POST /api/pagos. Ningún monto forma parte: el pago nuevo copia el monto del rechazado. Zod descarta las claves
// que no declara, así que un `monto` enviado se ignora.
const esquemaReenvio = z.object({
  pago_id: z.string({ error: "Indica qué pago quieres reemplazar." }).min(1, { error: "Indica qué pago quieres reemplazar." }),
  metodo: z.enum(["yape", "transferencia"], { error: "Elige cómo vas a pagar: Yape o transferencia." }),
  comprobante: z
    .string({ error: "Sube el comprobante de tu pago para continuar." })
    .min(1, { error: "Sube el comprobante de tu pago para continuar." })
    .max(300, { error: "La ruta del comprobante no es válida." }),
});

export type RespuestaReenvio = {
  pago: { id: string; concepto: string; monto: number; metodo: string; estado: string; reemplaza_a: string | null };
  // La reserva `pendiente` vigente apuntada al pago nuevo, o null si ya expiró o no había (el cliente elegirá un nuevo
  // horario cuando se apruebe: aprobación tardía).
  reserva: { id: string; estado: string; expira_en: string | null } | null;
};

// El cliente sube otro comprobante a un pago rechazado (design de revision-de-pagos-admin, decisión 7). Crea un pago NUEVO
// que copia usuario, concepto, membresía y monto del rechazado (nunca del cuerpo) y lo reemplaza (`reemplaza_a`): la
// historia del rechazo se conserva (ADR 0008). Si la reserva sigue `pendiente`, pasa a apuntar al pago nuevo SIN extender su
// `expira_en` (ADR 0009). El comprobante se verifica ANTES de abrir la transacción y se guarda solo la ruta devuelta.
export async function reenviarComprobante(
  { usuario, cuerpo }: { usuario: Usuario; cuerpo: unknown; ahora?: Date },
  dependencias: DependenciasReenvio = porDefecto,
): Promise<RespuestaReenvio> {
  // --- Fuera de la transacción ---
  const datos = validar(esquemaReenvio, cuerpo);
  if (!esUuid(datos.pago_id)) throw ErrorApi.noEncontrado(MENSAJE_PAGO_NO_ENCONTRADO);
  const imagen = await dependencias.verificarImagen({ ruta: datos.comprobante, usuario: { id: usuario.id, rol: usuario.rol } });
  const config = await dependencias.leerConfig();
  const zona = config.horario_atencion.zona;

  try {
    return await transaccionDeEscritura(async (tx) => {
      // 1. Bloquear el pago rechazado. Un pago ajeno responde 404 igual que uno inexistente.
      const [rechazado] = await tx
        .select()
        .from(pagos)
        .where(and(eq(pagos.id, datos.pago_id), eq(pagos.usuarioId, usuario.id)))
        .for("update");
      if (!rechazado) throw ErrorApi.noEncontrado(MENSAJE_PAGO_NO_ENCONTRADO);
      if (rechazado.estado !== "rechazado") throw ErrorApi.conflicto(MENSAJE_PAGO_NO_RECHAZADO);

      // 2. Bloquear la membresía: el cierre también la bloquea antes de evaluar su condición, así que o gana el reenvío
      //    y la membresía no se cierra, o gana el cierre y aquí se ve `caducada`.
      if (rechazado.membresiaId) {
        const [membresia] = await tx.select({ estado: membresias.estado }).from(membresias).where(eq(membresias.id, rechazado.membresiaId)).for("update");
        if (membresia?.estado === "caducada") throw plazoVencido();
      }

      // 3. El plazo se mide con el reloj de la base: revisado_en + reenvio_comprobante_dias > now().
      const [plazo] = await tx
        .select({ vigente: reenvioVigenteSql(config.reenvio_comprobante_dias) })
        .from(pagos)
        .where(eq(pagos.id, rechazado.id));
      if (!plazo?.vigente) throw plazoVencido();

      // 4. Una membresía tiene como máximo un pago pendiente.
      if (rechazado.membresiaId) {
        const pendientes = await tx
          .select({ id: pagos.id })
          .from(pagos)
          .where(and(eq(pagos.membresiaId, rechazado.membresiaId), eq(pagos.estado, "pendiente")))
          .limit(1);
        if (pendientes.length > 0) throw ErrorApi.conflicto(MENSAJE_COMPROBANTE_EN_REVISION);
      }

      // 5. El pago nuevo y, si la hay, la reserva vigente apuntando a él.
      const [nuevo] = await tx
        .insert(pagos)
        .values({
          usuarioId: rechazado.usuarioId,
          concepto: rechazado.concepto,
          membresiaId: rechazado.membresiaId,
          monto: rechazado.monto,
          metodo: datos.metodo,
          comprobanteRuta: imagen.ruta,
          estado: "pendiente",
          reemplazaA: rechazado.id,
        })
        .returning();
      // `transaccionDeEscritura` ya marcó las vencidas: toda reserva `pendiente` que queda sigue vigente.
      const [reserva] = await tx
        .update(reservas)
        .set({ pagoId: nuevo.id, actualizadaEn: sql`now()` })
        .where(and(eq(reservas.pagoId, rechazado.id), eq(reservas.estado, "pendiente")))
        .returning();

      return {
        pago: { id: nuevo.id, concepto: nuevo.concepto, monto: nuevo.monto, metodo: nuevo.metodo, estado: nuevo.estado, reemplaza_a: nuevo.reemplazaA },
        reserva: reserva ? { id: reserva.id, estado: reserva.estado, expira_en: reserva.expiraEn ? isoConZona(reserva.expiraEn, zona) : null } : null,
      };
    }, dependencias.base());
  } catch (error) {
    throw traducirUnicidad(error);
  }
}

// 409 con un código estable: el cliente (ítem 12) distingue «plazo vencido» de «pago en revisión» y ofrece empezar de nuevo.
const plazoVencido = () => new ErrorApi(409, "plazo_vencido", MENSAJE_PLAZO_VENCIDO);
