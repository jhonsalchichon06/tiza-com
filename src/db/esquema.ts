import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// Parámetros del negocio como datos (ADR 0008). `valor` se valida con zod al leerlo.
export const configuracion = pgTable("configuracion", {
  clave: varchar("clave", { length: 100 }).primaryKey(),
  valor: jsonb("valor").notNull(),
  provisional: boolean("provisional").notNull().default(false),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
});

// Cupos de trabajo; sumar capacidad es insertar un equipo (ADR 0007).
export const equipos = pgTable("equipos", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull().unique(),
  activo: boolean("activo").notNull().default(true),
});

// --- Autenticación (Better Auth, ADR 0005) ---
// Las propiedades siguen los nombres de campo que espera Better Auth; las tablas van en español.
// El hash de la contraseña vive en `cuentas.password` (proveedor "credential").

const fechas = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rolUsuario = pgEnum("rol_usuario", ["cliente", "admin"]);

export const usuarios = pgTable("usuarios", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  telefono: text("telefono").notNull(),
  rol: rolUsuario("rol").notNull().default("cliente"),
  ...fechas(),
});

export const sesiones = pgTable(
  "sesiones",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    ...fechas(),
  },
  (t) => [index("sesiones_user_id_idx").on(t.userId)],
);

export const cuentas = pgTable(
  "cuentas",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...fechas(),
  },
  (t) => [index("cuentas_user_id_idx").on(t.userId)],
);

export const verificaciones = pgTable(
  "verificaciones",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...fechas(),
  },
  (t) => [index("verificaciones_identifier_idx").on(t.identifier)],
);

// --- Membresías y pagos (ADR 0008 y 0009) ---

export const estadoMembresia = pgEnum("estado_membresia", ["pendiente", "activa", "caducada"]);
export const conceptoPago = pgEnum("concepto_pago", ["membresia", "reserva", "membresia_y_reserva"]);
export const metodoPago = pgEnum("metodo_pago", ["yape", "transferencia", "credito"]);
export const estadoPago = pgEnum("estado_pago", ["pendiente", "aprobado", "rechazado"]);

// Los 3 meses cuentan desde la aprobación: pendiente no tiene fechas; activa sí. "Vencida" no se guarda: se calcula con `fin`.
// `caducada` = venció el plazo para subir otro comprobante tras un rechazo (PRD, caso borde 1): no tiene fechas, no activó
// nada y deja al cliente empezar de nuevo. El CHECK no nombra `caducada`: Postgres no deja usar un valor de enum en la misma
// transacción que lo agrega, y la migración aplica todo en una sola.
export const membresias = pgTable(
  "membresias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    // Céntimos enteros, copia de lo cobrado.
    monto: integer("monto").notNull(),
    estado: estadoMembresia("estado").notNull(),
    inicio: timestamp("inicio", { withTimezone: true }),
    fin: timestamp("fin", { withTimezone: true }),
    creadaEn: timestamp("creada_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("membresias_monto_positivo", sql`${t.monto} > 0`),
    check(
      "membresias_estado_y_fechas",
      sql`(${t.estado} = 'activa' AND ${t.inicio} IS NOT NULL AND ${t.fin} IS NOT NULL AND ${t.fin} > ${t.inicio}) OR (${t.estado} <> 'activa' AND ${t.inicio} IS NULL AND ${t.fin} IS NULL)`,
    ),
    uniqueIndex("membresias_una_pendiente_por_cliente").on(t.usuarioId).where(sql`${t.estado} = 'pendiente'`),
  ],
);

export const pagos = pgTable(
  "pagos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    concepto: conceptoPago("concepto").notNull(),
    membresiaId: uuid("membresia_id").references(() => membresias.id),
    monto: integer("monto").notNull(),
    metodo: metodoPago("metodo").notNull(),
    // Ruta del comprobante en Blob (declarada en COLUMNAS_CON_IMAGEN para el cron de huérfanos).
    comprobanteRuta: text("comprobante_ruta"),
    estado: estadoPago("estado").notNull().default("pendiente"),
    revisadoPor: text("revisado_por").references(() => usuarios.id),
    revisadoEn: timestamp("revisado_en", { withTimezone: true }),
    // Motivo opcional del rechazo (hasta 200 caracteres).
    motivoRechazo: text("motivo_rechazo"),
    // El pago rechazado al que reemplaza este comprobante nuevo (ADR 0008): cada rechazado se reemplaza una sola vez.
    reemplazaA: uuid("reemplaza_a").references((): AnyPgColumn => pagos.id),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("pagos_monto_no_negativo", sql`${t.monto} >= 0`),
    check("pagos_membresia_si_concepto", sql`${t.concepto} = 'reserva' OR ${t.membresiaId} IS NOT NULL`),
    check("pagos_comprobante_si_no_credito", sql`${t.metodo} = 'credito' OR ${t.comprobanteRuta} IS NOT NULL`),
    check("pagos_credito_sin_monto", sql`${t.metodo} <> 'credito' OR ${t.monto} = 0`),
    check("pagos_motivo_rechazo_corto", sql`char_length(${t.motivoRechazo}) <= 200`),
    // Un pendiente no tiene revisor ni fecha; un rechazado, ambos. El aprobado no exige nada: los pagos internos con
    // crédito (ítem 14) se aprueban solos.
    check(
      "pagos_revision_coherente",
      sql`(${t.estado} = 'pendiente' AND ${t.revisadoPor} IS NULL AND ${t.revisadoEn} IS NULL) OR ${t.estado} = 'aprobado' OR (${t.estado} = 'rechazado' AND ${t.revisadoPor} IS NOT NULL AND ${t.revisadoEn} IS NOT NULL)`,
    ),
    uniqueIndex("pagos_un_reemplazo_por_pago").on(t.reemplazaA).where(sql`${t.reemplazaA} IS NOT NULL`),
    index("pagos_pendientes_idx").on(t.creadoEn).where(sql`${t.estado} = 'pendiente'`),
  ],
);

// --- Agenda (ADR 0002, 0007, 0008, 0009 y 0013) ---
// Cada reserva apunta a su membresía y a su pago; la agenda vive en la restricción de exclusión por equipo.
// `cancelada_por` dice quién canceló (cliente o administrador) y solo puede tener valor si la reserva está `cancelada`.

export const tipoServicio = pgEnum("tipo_servicio", ["estandar", "profunda", "mudanza", "paquete"]);
export const estadoReserva = pgEnum("estado_reserva", ["pendiente", "confirmada", "completada", "cancelada", "expirada"]);
export const estadoApoyo = pgEnum("estado_apoyo", ["por_coordinar", "coordinado"]);
// Quién canceló la reserva: el ítem 14 solo genera crédito en horas si fue el cliente (ADR 0012).
export const quienCancela = pgEnum("quien_cancela", ["cliente", "admin"]);

// La restricción de exclusión por equipo (`reservas_sin_solape_por_equipo`) vive solo en el SQL de la
// migración: drizzle-kit no genera EXCLUDE. Una prueba lee el SQL y falla si falta.
export const reservas = pgTable(
  "reservas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    equipoId: integer("equipo_id")
      .notNull()
      .references(() => equipos.id),
    membresiaId: uuid("membresia_id")
      .notNull()
      .references(() => membresias.id),
    pagoId: uuid("pago_id")
      .notNull()
      .references(() => pagos.id),
    tipo: tipoServicio("tipo").notNull(),
    dormitorios: smallint("dormitorios"),
    banos: smallint("banos"),
    // Múltiplos de 0,5 en numeric(4,1): Drizzle los devuelve como texto, se leen con Number().
    horasTrabajo: numeric("horas_trabajo", { precision: 4, scale: 1 }).notNull(),
    horasAgenda: numeric("horas_agenda", { precision: 4, scale: 1 }).notNull(),
    requiereApoyo: boolean("requiere_apoyo").notNull().default(false),
    apoyoEstado: estadoApoyo("apoyo_estado"),
    apoyoNota: text("apoyo_nota"),
    distrito: text("distrito").notNull(),
    calle: text("calle").notNull(),
    numero: text("numero").notNull(),
    departamento: text("departamento"),
    departamentoNormalizado: text("departamento_normalizado").notNull().default(""),
    referencias: text("referencias"),
    direccionNormalizada: text("direccion_normalizada").notNull(),
    inicio: timestamp("inicio", { withTimezone: true }).notNull(),
    fin: timestamp("fin", { withTimezone: true }).notNull(),
    finBloqueo: timestamp("fin_bloqueo", { withTimezone: true }).notNull(),
    // Copia de lo cobrado: si cambian los parámetros, el historial no cambia (ADR 0008). Céntimos enteros.
    precioLista: integer("precio_lista").notNull(),
    horasGratisAplicadas: numeric("horas_gratis_aplicadas", { precision: 4, scale: 1 }).notNull().default("0"),
    creditoAplicado: numeric("credito_aplicado", { precision: 4, scale: 1 }).notNull().default("0"),
    descuento: integer("descuento").notNull(),
    monto: integer("monto").notNull(),
    primeraGratis: boolean("primera_gratis").notNull().default(false),
    estado: estadoReserva("estado").notNull(),
    canceladaPor: quienCancela("cancelada_por"),
    // Cuándo se canceló (cliente o administrador). Fija el vencimiento del crédito en horas (ADR 0012): el lote puede nacer
    // después de la cancelación (aprobación tardía del pago) y `actualizada_en` se mueve con cualquier escritura posterior.
    canceladaEn: timestamp("cancelada_en", { withTimezone: true }),
    expiraEn: timestamp("expira_en", { withTimezone: true }),
    // Quién (id del administrador, sin clave foránea para no atar el historial a la cuenta) y cuándo reprogramó la reserva a
    // nombre del cliente (ítem 16, apoyo no conseguido). Opcionales: vacías en toda reserva que ningún administrador movió.
    // La reprogramación del cliente (ítem 12) no las escribe. Solo las ve el administrador.
    reprogramadaPor: text("reprogramada_por"),
    reprogramadaEn: timestamp("reprogramada_en", { withTimezone: true }),
    creadaEn: timestamp("creada_en", { withTimezone: true }).notNull().defaultNow(),
    actualizadaEn: timestamp("actualizada_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("reservas_fin_posterior_al_inicio", sql`${t.fin} > ${t.inicio}`),
    check("reservas_bloqueo_no_antes_del_fin", sql`${t.finBloqueo} >= ${t.fin}`),
    check("reservas_cancelada_por_coherente", sql`${t.canceladaPor} IS NULL OR ${t.estado} = 'cancelada'`),
    check("reservas_cancelada_en_coherente", sql`${t.canceladaEn} IS NULL OR ${t.estado} = 'cancelada'`),
    check("reservas_pendiente_con_vencimiento", sql`${t.estado} <> 'pendiente' OR ${t.expiraEn} IS NOT NULL`),
    check(
      "reservas_tamano_o_paquete",
      sql`(${t.tipo} = 'paquete' AND ${t.dormitorios} IS NULL AND ${t.banos} IS NULL) OR (${t.tipo} <> 'paquete' AND ${t.dormitorios} IS NOT NULL AND ${t.banos} IS NOT NULL)`,
    ),
    check(
      "reservas_apoyo_coherente",
      sql`(${t.requiereApoyo} AND ${t.apoyoEstado} IS NOT NULL) OR (NOT ${t.requiereApoyo} AND ${t.apoyoEstado} IS NULL)`,
    ),
    // Una reserva viva por pago: el pago de una cancelada o expirada puede reutilizarse (ADR 0009).
    uniqueIndex("reservas_un_pago_por_reserva_viva")
      .on(t.pagoId)
      .where(sql`${t.estado} IN ('pendiente', 'confirmada', 'completada')`),
    // Una sola reserva en espera por cliente: nadie bloquea horarios sin pagar.
    uniqueIndex("reservas_una_pendiente_por_cliente").on(t.usuarioId).where(sql`${t.estado} = 'pendiente'`),
    // Una sola limpieza gratis por cliente y por hogar (ADR 0008 y 0013). Las canceladas y expiradas no cuentan,
    // así la limpieza gratis se puede reusar. Una `pendiente` vencida sin marcar sí ocupa el índice: por eso todo
    // insert de reservas pasa por `transaccionDeEscritura`, que marca las vencidas antes (ADR 0009).
    uniqueIndex("reservas_primera_gratis_por_cliente")
      .on(t.usuarioId)
      .where(sql`${t.primeraGratis} AND ${t.estado} IN ('pendiente', 'confirmada', 'completada')`),
    uniqueIndex("reservas_primera_gratis_por_hogar")
      .on(t.distrito, t.direccionNormalizada, t.departamentoNormalizado)
      .where(sql`${t.primeraGratis} AND ${t.estado} IN ('pendiente', 'confirmada', 'completada')`),
    index("reservas_inicio_idx").on(t.inicio),
    index("reservas_expira_en_pendiente_idx").on(t.expiraEn).where(sql`${t.estado} = 'pendiente'`),
  ],
);

// --- Reseñas (ítem 18, PRD alcance 7 y 9) ---
// Reemplaza el "indicador de aprobada" del ADR 0002 por un estado de tres valores: un booleano no distingue "esperando" de
// "rechazada", y sin eso la cola del administrador volvería a mostrar las rechazadas. `aprobada` sigue siendo una consulta simple.
export const estadoResena = pgEnum("estado_resena", ["pendiente", "aprobada", "rechazada"]);

// Una reseña por limpieza (`reserva_id` único). Sin `usuario_id`: el dueño sale de la reserva y repetirlo permitiría que se
// desincronicen. Sin `ON DELETE CASCADE`, como el resto del esquema.
export const resenas = pgTable(
  "resenas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservaId: uuid("reserva_id")
      .notNull()
      .unique()
      .references(() => reservas.id),
    estrellas: smallint("estrellas").notNull(),
    comentario: text("comentario").notNull(),
    estado: estadoResena("estado").notNull().default("pendiente"),
    revisadaPor: text("revisada_por").references(() => usuarios.id),
    revisadaEn: timestamp("revisada_en", { withTimezone: true }),
    creadaEn: timestamp("creada_en", { withTimezone: true }).notNull().defaultNow(),
    actualizadaEn: timestamp("actualizada_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("resenas_estrellas_entre_1_y_5", sql`${t.estrellas} BETWEEN 1 AND 5`),
    check(
      "resenas_revision_coherente",
      sql`(${t.estado} = 'pendiente' AND ${t.revisadaPor} IS NULL AND ${t.revisadaEn} IS NULL) OR (${t.estado} <> 'pendiente' AND ${t.revisadaPor} IS NOT NULL AND ${t.revisadaEn} IS NOT NULL)`,
    ),
    // Landing: las aprobadas más recientes. Cola del administrador: las pendientes más antiguas.
    index("resenas_aprobadas_idx").on(t.revisadaEn.desc()).where(sql`${t.estado} = 'aprobada'`),
    index("resenas_pendientes_idx").on(t.creadaEn).where(sql`${t.estado} = 'pendiente'`),
  ],
);

// Fotos del servicio de una reserva completada (ítem 17). Solo se guarda la ruta del archivo en Blob; la imagen no va en la base.
// `ruta` está declarada en `COLUMNAS_CON_IMAGEN` (src/lib/imagenes/referencias.ts): sin eso el cron de huérfanos la borraría a las 24 horas.
// `ruta` única: un reintento duplicado choca (23505) en vez de crear dos filas. Sin ON DELETE CASCADE ni CHECK del ambiente
// (la lista de ambientes vive en src/lib/fotos/ambientes.ts y puede crecer sin migración).
export const fotosServicio = pgTable(
  "fotos_servicio",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservaId: uuid("reserva_id")
      .notNull()
      .references(() => reservas.id),
    ambiente: text("ambiente").notNull(),
    ruta: text("ruta").notNull().unique(),
    subidaPor: text("subida_por")
      .notNull()
      .references(() => usuarios.id),
    creadaEn: timestamp("creada_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fotos_servicio_reserva_idx").on(t.reservaId, t.creadaEn)],
);

// --- Crédito en horas por cancelación (ítem 14, ADR 0012) ---
// Un lote por cancelación del cliente con el pago aprobado. El saldo NO se guarda: es la suma de `horas_disponibles` de los
// lotes con `vence_en > now()`. Invariante: por lote, `horas_disponibles` + horas de sus usos `reservado` y `consumido` =
// `horas_iniciales`. Las horas valen en cualquier servicio y son múltiplos de 0,5 (numeric(4,1), como `horas_trabajo`).
export const estadoUsoCredito = pgEnum("estado_uso_credito", ["reservado", "consumido", "devuelto"]);

export const creditosHoras = pgTable(
  "creditos_horas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    // La reserva cancelada que originó el lote: única, así cancelar y aprobar a la vez no duplica el crédito.
    reservaOrigenId: uuid("reserva_origen_id")
      .notNull()
      .references(() => reservas.id),
    horasIniciales: numeric("horas_iniciales", { precision: 4, scale: 1 }).notNull(),
    horasDisponibles: numeric("horas_disponibles", { precision: 4, scale: 1 }).notNull(),
    // `reservas.cancelada_en` + `credito_vence_meses` de `configuracion`, con el reloj de la base. Devolver horas no lo cambia.
    venceEn: timestamp("vence_en", { withTimezone: true }).notNull(),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("creditos_horas_iniciales_positivas", sql`${t.horasIniciales} > 0`),
    check("creditos_horas_disponibles_en_rango", sql`${t.horasDisponibles} >= 0 AND ${t.horasDisponibles} <= ${t.horasIniciales}`),
    check(
      "creditos_horas_medias_horas",
      sql`mod(${t.horasIniciales} * 2, 1) = 0 AND mod(${t.horasDisponibles} * 2, 1) = 0`,
    ),
    uniqueIndex("creditos_un_lote_por_cancelacion").on(t.reservaOrigenId),
    index("creditos_horas_usuario_vence_idx").on(t.usuarioId, t.venceEn),
  ],
);

// Cada vez que una reserva toma horas de un lote queda un uso: sin esto se perdería el detalle "dónde salió y en qué se usó".
export const usosCredito = pgTable(
  "usos_credito",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creditoId: uuid("credito_id")
      .notNull()
      .references(() => creditosHoras.id),
    reservaDestinoId: uuid("reserva_destino_id")
      .notNull()
      .references(() => reservas.id),
    horas: numeric("horas", { precision: 4, scale: 1 }).notNull(),
    estado: estadoUsoCredito("estado").notNull(),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("usos_credito_horas_positivas", sql`${t.horas} > 0 AND mod(${t.horas} * 2, 1) = 0`),
    uniqueIndex("usos_credito_un_uso_por_lote_y_reserva").on(t.creditoId, t.reservaDestinoId),
    index("usos_credito_reserva_destino_idx").on(t.reservaDestinoId),
  ],
);
