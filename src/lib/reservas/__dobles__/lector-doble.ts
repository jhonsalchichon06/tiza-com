import { PgDialect } from "drizzle-orm/pg-core";

// Doble mínimo de un lector (`select().from().where().orderBy().limit()`): devuelve las filas que le pasan después de
// aplicar lo que la consulta dice en su SQL (los valores enlazados y el orden). Registra el SQL para comprobar filtros.
type Fila = Record<string, unknown>;

export function crearLectorDoble(filas: Fila[], opciones: { columnaUsuario?: string; columnaEstado?: string; columnaOrden?: string } = {}) {
  const dialecto = new PgDialect();
  const consultas: { sql: string; params: unknown[] }[] = [];
  const { columnaUsuario = "usuarioId", columnaEstado = "estado", columnaOrden = "fin" } = opciones;

  const lector = {
    select: () => ({
      from: () => ({
        where: (donde: unknown) => {
          const q = dialecto.sqlToQuery(donde as Parameters<PgDialect["sqlToQuery"]>[0]);
          consultas.push(q);
          let resultado = filas.filter((f) => {
            const dueno = f[columnaUsuario];
            const estado = f[columnaEstado];
            return (dueno === undefined || q.params.includes(dueno)) && (estado === undefined || q.params.includes(estado));
          });
          const consulta: Record<string, unknown> = {
            orderBy: () => {
              resultado = [...resultado].sort((a, b) => (b[columnaOrden] as Date).getTime() - (a[columnaOrden] as Date).getTime());
              return consulta;
            },
            limit: async (n: number) => resultado.slice(0, n),
          };
          return consulta;
        },
      }),
    }),
  };
  return { lector: lector as never, consultas };
}
