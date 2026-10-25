import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/cliente";
import { membresias, pagos } from "@/db/esquema";
import { transaccionDeEscritura, type BaseDatos } from "../agenda/expirar";
import { leerConfiguracion, type Configuracion } from "../configuracion";
import { ErrorApi } from "../errores";
import { verificarImagenSubida, type ImagenVerificada } from "../imagenes/verificar";
import { cerrarMembresiasSinReenvio } from "../pagos/cierre";
import { reenvioHastaSql } from "../pagos/plazo";
import { formatearFecha } from "../perfil/textos";
import { mensajePagoRechazado } from "../reservas/crear";
import { traducirUnicidad } from "../reservas/unicidad";
import type { Usuario } from "../sesion";
import { validar } from "../validacion-sesion";
import { planDeRenovacion, type PlanDeRenovacion } from "./plan";

type ConfigRenovar = Pick<Configuracion, "reenvio_comprobante_dias" | "horario_atencion" | "membresia_meses" | "membresia_precio_mensual">;

export type DependenciasRenovar = {
  leerConfig: () => Promise<ConfigRenovar>;
  verificarImagen: (entrada: { ruta: unknown; usuario: Pick<Usuario, "id" | "rol"> }) => Promise<ImagenVerificada>;
  base: () => Pick<BaseDatos, "transaction">;
  // Único origen del monto y de la duración (decisión provisional del PRD): por defecto lee `configuracion`.
  plan: (config: ConfigRenovar) => PlanDeRenovacion;
};

const porDefecto: DependenciasRenovar = {
  leerConfig: () => leerConfiguracion(),
  verificarImagen: (entrada) => verificarImagenSubida(entrada),
  base: () => db(),
  plan: planDeRenovacion,
};

export const MENSAJE_RENOVACION_SIN_MEMBRESIA = "Aún no eres miembro de Tiza Club. Reserva tu primera limpieza para activar tu membresía.";
export const MENSAJE_RENOVACION_EN_REVISION = "Tu pago de renovación ya está en revisión. Cuando se apruebe, podrás elegir día y hora desde tu perfil.";
export const mensajeMembresiaVigente = (fin: Date, zona: string) =>
  `Tu membresía sigue vigente hasta el ${formatearFecha(fin, zona)}. Podrás renovarla cuando venza.`;

// Cuerpo de POST /api/membresia/renovar. Ningún monto forma parte: lo calcula el servidor con el plan. Zod descarta las
// claves que no declara, así que un `monto` enviado se ignora.
const esquemaRenovar = z.object({
  metodo: z.enum(["yape", "transferencia"], { error: "Elige cómo vas a pagar: Yape o transferencia." }),
  comprobante: z
    .string({ error: "Sube el comprobante de tu pago para continuar." })
    .min(1, { error: "Sube el comprobante de tu pago para continuar." })
    .max(300, { error: "La ruta del comprobante no es válida." }),
});

export type RespuestaRenovar = {
  membresia: { id: string; estado: string; monto: number };
  pago: { id: string; concepto: string; monto: number; metodo: string; estado: string };
  plan: PlanDeRenovacion;
};

// Renovar = una membresía NUEVA `pendiente` + un pago `membresia` `pendiente`, sin reserva ni horas gratis (ADR 0008; design
// de renovacion-del-mes-4, decisión 3). No llama a `decidirLimpiezaGratis` ni escribe en `reservas`. El comprobante se
// verifica ANTES de abrir la transacción y se guarda solo la ruta devuelta (ADR 0010). Solo se renueva con la membresía
// vencida (reloj de la base) y sin otra pendiente; la aprobación y el rechazo son los del ítem 11.
export async function renovarMembresia(
  { usuario, cuerpo }: { usuario: Usuario; cuerpo: unknown; ahora?: Date },
  dependencias: DependenciasRenovar = porDefecto,
): Promise<RespuestaRenovar> {
  // --- Fuera de la transacción ---
  const datos = validar(esquemaRenovar, cuerpo);
  const imagen = await dependencias.verificarImagen({ ruta: datos.comprobante, usuario: { id: usuario.id, rol: usuario.rol } });
  const config = await dependencias.leerConfig();
  const plan = dependencias.plan(config);
  const zona = config.horario_atencion.zona;

  try {
    return await transaccionDeEscritura(async (tx) => {
      // Quien pasó el plazo para reenviar su comprobante puede empezar de nuevo: se cierra su pendiente en esta petición.
      await cerrarMembresiasSinReenvio(tx, config.reenvio_comprobante_dias);

      // Se bloquean las membresías del cliente: dos renovaciones simultáneas se turnan y la segunda ve la pendiente.
      const propias = await tx
        .select({ id: membresias.id, estado: membresias.estado, fin: membresias.fin, vigente: sql<boolean>`coalesce(${membresias.fin} > now(), false)` })
        .from(membresias)
        .where(eq(membresias.usuarioId, usuario.id))
        .for("update");

      const activas = propias.filter((m) => m.estado === "activa");
      if (activas.length === 0) throw new ErrorApi(409, "renovacion_no_aplica", MENSAJE_RENOVACION_SIN_MEMBRESIA);
      const vigente = activas.filter((m) => m.vigente).sort((a, b) => (b.fin?.getTime() ?? 0) - (a.fin?.getTime() ?? 0))[0];
      if (vigente?.fin) throw new ErrorApi(409, "renovacion_no_aplica", mensajeMembresiaVigente(vigente.fin, zona));

      const pendiente = propias.find((m) => m.estado === "pendiente");
      if (pendiente) {
        const [ultimoPago] = await tx
          .select({ estado: pagos.estado, reenvioHasta: reenvioHastaSql(config.reenvio_comprobante_dias) })
          .from(pagos)
          .where(eq(pagos.membresiaId, pendiente.id))
          .orderBy(desc(pagos.creadoEn))
          .limit(1);
        if (ultimoPago?.estado === "rechazado" && ultimoPago.reenvioHasta) {
          throw new ErrorApi(409, "pago_rechazado", mensajePagoRechazado(new Date(ultimoPago.reenvioHasta), zona));
        }
        throw new ErrorApi(409, "en_espera", MENSAJE_RENOVACION_EN_REVISION);
      }

      const [membresia] = await tx.insert(membresias).values({ usuarioId: usuario.id, monto: plan.monto, estado: "pendiente" }).returning();
      const [pago] = await tx
        .insert(pagos)
        .values({
          usuarioId: usuario.id,
          concepto: "membresia",
          membresiaId: membresia.id,
          monto: plan.monto,
          metodo: datos.metodo,
          comprobanteRuta: imagen.ruta,
          estado: "pendiente",
        })
        .returning();
      return {
        membresia: { id: membresia.id, estado: membresia.estado, monto: membresia.monto },
        pago: { id: pago.id, concepto: pago.concepto, monto: pago.monto, metodo: pago.metodo, estado: pago.estado },
        plan,
      };
    }, dependencias.base());
  } catch (error) {
    throw traducirUnicidad(error);
  }
}

