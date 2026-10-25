import { sql } from "drizzle-orm";
import { isoConZona } from "../agenda/horario";
import { ErrorApi } from "../errores";
import { leerSaldoYVencimiento } from "./saldo";
import { aFecha, aNumero, filas, type Ejecutor } from "./sql";

// Lectura del crédito en horas para el cliente y para el administrador (ADR 0012; design de credito-en-horas, decisión 9).
// Solo lectura: nada de aquí escribe. Todas las consultas del cliente llevan su `usuario_id` (ADR 0005); el del administrador
// llega de la ruta ya autenticada como administrador. Las fechas salen en la zona de `horario_atencion` (`isoConZona`).

export const MAXIMO_DE_LOTES = 20;
export const MAXIMO_DE_MOVIMIENTOS = 50;
export const MAXIMO_DE_CLIENTES = 100;

export type LoteVista = {
  id: string;
  horas_iniciales: number;
  horas_disponibles: number;
  creado_en: string;
  vence_en: string;
  // Calculado en SQL con el reloj de la base: un lote vencido se muestra pero no cuenta en el saldo.
  vigente: boolean;
  // La reserva cancelada que originó el lote: su fecha de servicio y la fecha en que se canceló (de ahí corre el vencimiento).
  origen: { reserva_id: string; inicio: string; cancelada_en: string | null };
};

export type MovimientoVista = {
  tipo: "generado" | "usado" | "devuelto";
  horas: number;
  fecha: string;
  // La reserva cancelada que originó el lote (`generado`) o la que usó las horas (`usado` y `devuelto`).
  reserva: { id: string; inicio: string };
};

export type CreditosVista = {
  saldo_horas: number;
  // El lote vigente que vence primero: sus horas disponibles y su `vence_en` (hora de Lima), o null si no hay crédito vigente.
  proximo_vencimiento: { horas: number; vence_en: string } | null;
  lotes: LoteVista[];
  movimientos: MovimientoVista[];
};

type FilaLote = {
  id: string;
  horas_iniciales: string;
  horas_disponibles: string;
  creado_en: Date | string;
  vence_en: Date | string;
  vigente: boolean;
  reserva_origen_id: string;
  origen_inicio: Date | string;
  origen_cancelada_en: Date | string | null;
};

type FilaMovimiento = { tipo: MovimientoVista["tipo"]; horas: string; fecha: Date | string; reserva_id: string; reserva_inicio: Date | string };

export async function leerCreditos(base: Ejecutor, usuarioId: string, zona: string): Promise<CreditosVista> {
  const { horas, proximoVencimiento } = await leerSaldoYVencimiento(base, usuarioId);

  const lotes = filas<FilaLote>(
    await base.execute(sql`
      SELECT c."id", c."horas_iniciales", c."horas_disponibles", c."creado_en", c."vence_en", (c."vence_en" > now()) AS "vigente",
        c."reserva_origen_id", r."inicio" AS "origen_inicio", r."cancelada_en" AS "origen_cancelada_en"
      FROM "creditos_horas" c JOIN "reservas" r ON r."id" = c."reserva_origen_id"
      WHERE c."usuario_id" = ${usuarioId}
      ORDER BY c."vence_en" DESC, c."id" LIMIT ${MAXIMO_DE_LOTES}`),
  );

  const movimientos = filas<FilaMovimiento>(
    await base.execute(sql`
      SELECT * FROM (
        SELECT 'generado' AS "tipo", c."horas_iniciales" AS "horas", c."creado_en" AS "fecha", c."reserva_origen_id" AS "reserva_id", r."inicio" AS "reserva_inicio"
        FROM "creditos_horas" c JOIN "reservas" r ON r."id" = c."reserva_origen_id"
        WHERE c."usuario_id" = ${usuarioId}
        UNION ALL
        SELECT 'usado', u."horas", u."creado_en", u."reserva_destino_id", r."inicio"
        FROM "usos_credito" u JOIN "creditos_horas" c ON c."id" = u."credito_id" JOIN "reservas" r ON r."id" = u."reserva_destino_id"
        WHERE c."usuario_id" = ${usuarioId}
        UNION ALL
        SELECT 'devuelto', u."horas", u."actualizado_en", u."reserva_destino_id", r."inicio"
        FROM "usos_credito" u JOIN "creditos_horas" c ON c."id" = u."credito_id" JOIN "reservas" r ON r."id" = u."reserva_destino_id"
        WHERE c."usuario_id" = ${usuarioId} AND u."estado" = 'devuelto'
      ) m ORDER BY "fecha" DESC, "tipo" LIMIT ${MAXIMO_DE_MOVIMIENTOS}`),
  );

  return {
    saldo_horas: horas,
    proximo_vencimiento: proximoVencimiento ? { horas: proximoVencimiento.horas, vence_en: isoConZona(proximoVencimiento.venceEn, zona) } : null,
    lotes: lotes.map((l) => ({
      id: l.id,
      horas_iniciales: aNumero(l.horas_iniciales),
      horas_disponibles: aNumero(l.horas_disponibles),
      creado_en: isoConZona(aFecha(l.creado_en), zona),
      vence_en: isoConZona(aFecha(l.vence_en), zona),
      vigente: Boolean(l.vigente),
      origen: {
        reserva_id: l.reserva_origen_id,
        inicio: isoConZona(aFecha(l.origen_inicio), zona),
        cancelada_en: l.origen_cancelada_en ? isoConZona(aFecha(l.origen_cancelada_en), zona) : null,
      },
    })),
    movimientos: movimientos.map((m) => ({
      tipo: m.tipo,
      horas: aNumero(m.horas),
      fecha: isoConZona(aFecha(m.fecha), zona),
      reserva: { id: m.reserva_id, inicio: isoConZona(aFecha(m.reserva_inicio), zona) },
    })),
  };
}

// ---- Portal del administrador (solo lectura) ----

export type ClienteConCredito = {
  usuario_id: string;
  nombre: string;
  correo: string;
  saldo_horas: number;
  proximo_vencimiento: string | null;
  lotes: number;
};

type FilaCliente = { usuario_id: string; nombre: string; correo: string; saldo: string; proximo: Date | string | null; lotes: string | number };

// Clientes con algún lote (máximo 100), el de vencimiento más próximo primero; los que ya no tienen crédito vigente, al final.
export async function listarCreditosAdmin(base: Ejecutor, zona: string): Promise<ClienteConCredito[]> {
  const clientes = filas<FilaCliente>(
    await base.execute(sql`
      SELECT u."id" AS "usuario_id", u."name" AS "nombre", u."email" AS "correo",
        COALESCE(SUM(c."horas_disponibles") FILTER (WHERE c."vence_en" > now()), 0) AS "saldo",
        MIN(c."vence_en") FILTER (WHERE c."vence_en" > now() AND c."horas_disponibles" > 0) AS "proximo",
        COUNT(*) AS "lotes"
      FROM "creditos_horas" c JOIN "usuarios" u ON u."id" = c."usuario_id"
      GROUP BY u."id", u."name", u."email"
      ORDER BY "proximo" ASC NULLS LAST, u."id" LIMIT ${MAXIMO_DE_CLIENTES}`),
  );
  return clientes.map((c) => ({
    usuario_id: c.usuario_id,
    nombre: c.nombre,
    correo: c.correo,
    saldo_horas: aNumero(c.saldo),
    proximo_vencimiento: c.proximo ? isoConZona(aFecha(c.proximo), zona) : null,
    lotes: aNumero(c.lotes),
  }));
}

export type DetalleAdmin = CreditosVista & { cliente: { usuario_id: string; nombre: string; correo: string } };

export const MENSAJE_CLIENTE_NO_ENCONTRADO = "No encontramos a ese cliente.";

// El `usuarioId` de Better Auth es texto, no uuid: se comprueba que exista y, si no, 404.
export async function detalleCreditosAdmin(base: Ejecutor, usuarioId: string, zona: string): Promise<DetalleAdmin> {
  const [cliente] = filas<{ id: string; nombre: string; correo: string }>(
    await base.execute(sql`SELECT "id", "name" AS "nombre", "email" AS "correo" FROM "usuarios" WHERE "id" = ${usuarioId} LIMIT 1`),
  );
  if (!cliente) throw ErrorApi.noEncontrado(MENSAJE_CLIENTE_NO_ENCONTRADO);
  const creditos = await leerCreditos(base, usuarioId, zona);
  return { cliente: { usuario_id: cliente.id, nombre: cliente.nombre, correo: cliente.correo }, ...creditos };
}
