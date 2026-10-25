import { PgDialect } from "drizzle-orm/pg-core";
import { equipos, membresias, pagos, reservas } from "@/db/esquema";

// Doble de la base para probar `crearPrimeraReserva` sin red: reproduce solo lo que la creación usa
// (select por tabla, insert con returning, update de expirar y transacciones con savepoint) y registra lo escrito.
// Si la transacción falla se "deshace": no queda ninguna fila registrada, como en la base real.

export type Opciones = {
  reservaPendiente?: boolean;
  reservasVivas?: boolean; // ¿tiene una reserva pendiente, confirmada o completada? (decide las horas gratis)
  hogarUsado?: boolean; // ¿otra cuenta ya tiene la limpieza gratis de este hogar? (decide las horas gratis)
  membresias?: { id: string; estado: "pendiente" | "activa" | "caducada" }[];
  // Membresías que el cierre por plazo vencido encuentra y pasa a `caducada` al abrir la transacción.
  cierra?: string[];
  // Último pago de la membresía pendiente: `rechazado` con su fecha límite de reenvío, o `pendiente` (sin fecha).
  ultimoPago?: { estado: "pendiente" | "rechazado"; reenvioHasta?: string };
  equipos?: number[];
  sinCupo?: boolean;
  falloAlInsertar?: { tabla: "membresias" | "pagos" | "reservas"; error: unknown };
};

export type Fila = Record<string, unknown>;

export function crearBaseDoble(opciones: Opciones = {}, ahoraDb = () => new Date()) {
  const dialecto = new PgDialect();
  const estado = {
    transacciones: 0,
    operaciones: [] as string[],
    membresias: [] as Fila[],
    pagos: [] as Fila[],
    reservas: [] as Fila[],
    intentosDeEquipo: [] as number[],
    membresiasPrevias: (opciones.membresias ?? []).map((m) => ({ ...m })),
  };
  const consulta = (donde: unknown) => dialecto.sqlToQuery(donde as Parameters<PgDialect["sqlToQuery"]>[0]);

  function nombreDe(tabla: unknown): "membresias" | "pagos" | "reservas" | "equipos" {
    if (tabla === membresias) return "membresias";
    if (tabla === pagos) return "pagos";
    if (tabla === reservas) return "reservas";
    if (tabla === equipos) return "equipos";
    throw new Error("tabla inesperada en el doble");
  }

  function insertar(tabla: unknown) {
    const nombre = nombreDe(tabla);
    return {
      values(valores: Fila) {
        return {
          async returning() {
            estado.operaciones.push(`insert:${nombre}`);
            if (opciones.falloAlInsertar?.tabla === nombre) throw opciones.falloAlInsertar.error;
            if (nombre === "reservas") {
              estado.intentosDeEquipo.push(valores.equipoId as number);
              if (opciones.sinCupo) throw Object.assign(new Error("exclusion"), { cause: { code: "23P01" } });
            }
            const fila: Fila = {
              id: `${nombre}-${estado[nombre as "membresias" | "pagos" | "reservas"].length + 1}`,
              ...(nombre === "pagos" ? { estado: "pendiente" } : {}),
              ...valores,
              // La base resuelve `now() + …` y devuelve un instante.
              ...(nombre === "reservas" ? { expiraEn: new Date(ahoraDb().getTime() + 24 * 3_600_000) } : {}),
            };
            estado[nombre as "membresias" | "pagos" | "reservas"].push(fila);
            return [fila];
          },
        };
      },
    };
  }

  const tx = {
    update: (tabla: unknown) => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            if (tabla === membresias) {
              estado.operaciones.push("update:cierre");
              const cerradas = estado.membresiasPrevias.filter((m) => opciones.cierra?.includes(m.id));
              for (const m of cerradas) m.estado = "caducada";
              return cerradas.map((m) => ({ id: m.id }));
            }
            estado.operaciones.push("update:expirar");
            return [];
          },
        }),
      }),
    }),
    select: () => ({
      from(tabla: unknown) {
        const nombre = nombreDe(tabla);
        const resolver = (donde?: unknown, conBloqueo = false) => {
          estado.operaciones.push(conBloqueo ? `select:${nombre}:bloqueo` : `select:${nombre}`);
          // El cierre por plazo vencido: SELECT ... FOR UPDATE de las membresías candidatas.
          if (conBloqueo && nombre === "membresias") return (opciones.cierra ?? []).map((id) => ({ id }));
          if (nombre === "membresias") return estado.membresiasPrevias;
          if (nombre === "pagos") return opciones.ultimoPago ? [{ estado: opciones.ultimoPago.estado, reenvioHasta: opciones.ultimoPago.reenvioHasta ?? null }] : [];
          if (nombre === "equipos") return (opciones.equipos ?? [1, 2]).map((id) => ({ id }));
          // Tres consultas a reservas: la de la reserva en espera (solo 'pendiente'), la de las horas gratis del cliente
          // ('confirmada', …) y la del hogar (con `primera_gratis`).
          const q = donde === undefined ? undefined : consulta(donde);
          const esDelHogar = q !== undefined && q.sql.includes('"primera_gratis"');
          const esDeGratis = q !== undefined && !esDelHogar && q.params.includes("confirmada");
          const hay = esDelHogar ? opciones.hogarUsado : esDeGratis ? opciones.reservasVivas : opciones.reservaPendiente;
          return hay ? [{ id: "existente" }] : [];
        };
        return {
          where: (donde: unknown) => {
            let bloqueo = false;
            const filas = () => resolver(donde, bloqueo);
            const consulta: Record<string, unknown> = {
              for: () => {
                bloqueo = true;
                return consulta;
              },
              limit: async () => filas(),
              orderBy: () => consulta,
              then: (a: (v: unknown) => unknown, b: (e: unknown) => unknown) => Promise.resolve().then(filas).then(a, b),
            };
            return consulta;
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
      const copia = { m: [...estado.membresias], p: [...estado.pagos], r: [...estado.reservas] };
      try {
        return await fn(tx);
      } catch (error) {
        // Como un ROLLBACK: lo escrito dentro de la transacción desaparece.
        estado.membresias = copia.m;
        estado.pagos = copia.p;
        estado.reservas = copia.r;
        throw error;
      }
    },
  };

  return { base: base as unknown as Pick<import("@/lib/agenda/expirar").BaseDatos, "transaction">, estado };
}
