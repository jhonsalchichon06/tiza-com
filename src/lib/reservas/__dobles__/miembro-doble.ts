import { PgDialect } from "drizzle-orm/pg-core";
import { equipos, membresias, pagos, reservas } from "@/db/esquema";

// Doble de la base para probar la reserva de un miembro y el nuevo horario sin red. Responde cada lectura según la tabla y
// el SQL que armó la función (como `base-doble`, pero con las lecturas del miembro) y registra lo escrito. Si la transacción
// falla se "deshace": no queda ninguna fila registrada, como en la base real.

export type Fila = Record<string, unknown>;

export type OpcionesMiembro = {
  // Membresía `activa` que autoriza (la lectura devuelve la de fin más lejano). null/ausente = ninguna.
  membresia?: { id: string; inicio?: Date; fin: Date; vigente: boolean } | null;
  reservaPendiente?: boolean; // ya tiene una reserva `pendiente` (la regla de una en espera)
  reservasVivas?: boolean; // tiene otra reserva viva o realizada (decide las horas gratis por cliente)
  hogarUsado?: boolean; // otra cuenta ya recibió la gratis del hogar
  // Pagos aprobados sin reserva viva (`pagosConHorarioPendiente`) y la última reserva de cada uno (para el filtro de #12).
  pagosSinHorario?: Fila[];
  ultimasDePagos?: { pagoId: string; estado: string; canceladaPor: string | null }[];
  // Nuevo horario: el pago del dueño (la consulta lo devuelve solo si el id y el usuario coinciden) y su reserva más reciente.
  pagoPropio?: Fila;
  reservaOrigen?: Fila;
  equipos?: number[];
  // Lotes de crédito en horas vigentes del cliente (ítem 14). Sin ellos no hay crédito.
  lotes?: { id: string; venceEn: Date; horasDisponibles: number }[];
  fallaDescuento?: boolean; // el UPDATE del lote no afecta filas (invariante roto)
  sinCupo?: boolean; // toda inserción de reserva choca con la restricción de exclusión (23P01)
  // Error al insertar la reserva (por ejemplo, el 23505 de un índice único).
  falloAlInsertarReserva?: unknown;
  // Respuestas propias por tabla para lecturas que este doble no conoce (nuevo horario). Devuelve undefined para seguir.
  responder?: (lectura: { tabla: "membresias" | "pagos" | "reservas" | "equipos"; sql: string; params: unknown[]; conBloqueo: boolean }) => Fila[] | undefined;
};

export function crearMiembroDoble(opciones: OpcionesMiembro = {}, ahoraDb = () => new Date()) {
  const dialecto = new PgDialect();
  const estado = {
    transacciones: 0,
    operaciones: [] as string[],
    pagos: [] as Fila[],
    reservas: [] as Fila[],
    intentosDeEquipo: [] as number[],
    // Crédito: horas descontadas por lote y usos registrados (se deshacen con la transacción).
    descuentos: [] as { creditoId: string; horas: number }[],
    usos: [] as { creditoId: string; reservaId: string; horas: number; estado: string }[],
    lecturas: [] as { tabla: string; sql: string; params: unknown[] }[],
  };
  const consulta = (donde: unknown) => dialecto.sqlToQuery(donde as Parameters<PgDialect["sqlToQuery"]>[0]);

  const nombreDe = (tabla: unknown): "membresias" | "pagos" | "reservas" | "equipos" => {
    if (tabla === membresias) return "membresias";
    if (tabla === pagos) return "pagos";
    if (tabla === reservas) return "reservas";
    if (tabla === equipos) return "equipos";
    throw new Error("tabla inesperada en el doble");
  };

  function leer(nombre: "membresias" | "pagos" | "reservas" | "equipos", donde: unknown, conBloqueo: boolean): Fila[] {
    estado.operaciones.push(conBloqueo ? `select:${nombre}:bloqueo` : `select:${nombre}`);
    const q = donde === undefined ? { sql: "", params: [] as unknown[] } : consulta(donde);
    estado.lecturas.push({ tabla: nombre, ...q });
    const propia = opciones.responder?.({ tabla: nombre, ...q, conBloqueo });
    if (propia) return propia;
    if (nombre === "equipos") return (opciones.equipos ?? [1, 2]).map((id) => ({ id }));
    if (nombre === "membresias") {
      const m = opciones.membresia;
      return m ? [{ id: m.id, inicio: m.inicio ?? new Date("2026-10-01T15:00:00Z"), fin: m.fin, vigente: m.vigente }] : [];
    }
    if (nombre === "pagos") {
      if (/not exists/i.test(q.sql)) return opciones.pagosSinHorario ?? [];
      const p = opciones.pagoPropio;
      return p && q.params.includes(p.id) && q.params.includes(p.usuarioId) ? [p] : [];
    }
    if (q.sql.includes('"pago_id" in')) return (opciones.ultimasDePagos ?? []) as Fila[];
    if (q.sql.includes('"pago_id" = ')) {
      const o = opciones.reservaOrigen;
      return o && q.params.includes(o.pagoId) ? [o] : [];
    }
    if (q.sql.includes('"primera_gratis"')) return opciones.hogarUsado ? [{ id: "existente" }] : [];
    if (q.params.includes("confirmada")) return opciones.reservasVivas ? [{ id: "existente" }] : [];
    return opciones.reservaPendiente ? [{ id: "existente" }] : [];
  }

  function insertar(tabla: unknown) {
    const nombre = nombreDe(tabla);
    if (nombre !== "pagos" && nombre !== "reservas") throw new Error("tabla inesperada al insertar");
    return {
      values(valores: Fila) {
        return {
          async returning() {
            estado.operaciones.push(`insert:${nombre}`);
            if (nombre === "reservas") {
              estado.intentosDeEquipo.push(valores.equipoId as number);
              if (opciones.sinCupo) throw Object.assign(new Error("exclusion"), { cause: { code: "23P01" } });
              if (opciones.falloAlInsertarReserva) throw opciones.falloAlInsertarReserva;
            }
            const fila: Fila = {
              id: `${nombre}-${estado[nombre].length + 1}`,
              ...(nombre === "pagos" ? { estado: "pendiente", revisadoPor: null, revisadoEn: null } : {}),
              ...valores,
              // La base resuelve `now() + …` y devuelve un instante.
              ...(nombre === "reservas" ? { expiraEn: valores.expiraEn ? new Date(ahoraDb().getTime() + 24 * 3_600_000) : null } : {}),
            };
            estado[nombre].push(fila);
            return [fila];
          },
        };
      },
    };
  }

  const tx = {
    execute: async (consultaSql: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const q = dialecto.sqlToQuery(consultaSql);
      const texto = q.sql.replace(/\s+/g, " ").trim();
      if (texto.startsWith("SELECT")) {
        estado.operaciones.push("select:creditos:bloqueo");
        return { rows: (opciones.lotes ?? []).map((l) => ({ id: l.id, vence_en: l.venceEn, horas_disponibles: String(l.horasDisponibles) })) };
      }
      if (texto.startsWith("UPDATE")) {
        estado.operaciones.push("update:creditos");
        if (opciones.fallaDescuento) return { rows: [] };
        estado.descuentos.push({ creditoId: q.params[1] as string, horas: q.params[0] as number });
        return { rows: [{ id: q.params[1] }] };
      }
      estado.operaciones.push("insert:usos");
      estado.usos.push({ creditoId: q.params[0] as string, reservaId: q.params[1] as string, horas: q.params[2] as number, estado: q.params[3] as string });
      return { rows: [] };
    },
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            estado.operaciones.push("update:expirar");
            return [];
          },
        }),
      }),
    }),
    select: () => ({
      from(tabla: unknown) {
        const nombre = nombreDe(tabla);
        return {
          where: (donde: unknown) => {
            let bloqueo = false;
            const filas = () => leer(nombre, donde, bloqueo);
            const c: Record<string, unknown> = {
              for: () => {
                bloqueo = true;
                return c;
              },
              limit: async () => filas(),
              orderBy: () => c,
              then: (a: (v: unknown) => unknown, b: (e: unknown) => unknown) => Promise.resolve().then(filas).then(a, b),
            };
            return c;
          },
        };
      },
    }),
    insert: insertar,
    transaction: async <T>(fn: (sp: unknown) => Promise<T>): Promise<T> => fn(tx),
  };

  const base = {
    transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => {
      estado.transacciones++;
      const copia = { p: [...estado.pagos], r: [...estado.reservas], d: [...estado.descuentos], u: [...estado.usos] };
      try {
        return await fn(tx);
      } catch (error) {
        // Como un ROLLBACK: lo escrito dentro de la transacción desaparece.
        estado.pagos = copia.p;
        estado.reservas = copia.r;
        estado.descuentos = copia.d;
        estado.usos = copia.u;
        throw error;
      }
    },
  };

  // `lector` es el mismo doble sin transacción, para las lecturas (GET) que no abren una.
  return {
    base: base as unknown as Pick<import("@/lib/agenda/expirar").BaseDatos, "transaction">,
    lector: tx as unknown as Pick<import("@/lib/agenda/expirar").BaseDatos, "select">,
    estado,
  };
}
