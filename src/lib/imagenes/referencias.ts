import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable, type AnyPgColumn, type AnyPgTable } from "drizzle-orm/pg-core";
import { fotosServicio, pagos } from "@/db/esquema";
import type { BaseDatos } from "../agenda/expirar";

export type ColumnaConImagen = { tabla: AnyPgTable; columna: AnyPgColumn };

// Registro ÚNICO de las columnas de la base que guardan la ruta de una imagen de Blob. El cron de huérfanos
// solo borra lo que no aparezca en estas columnas, y con el registro vacío no borra nada.
//
// Cada ítem que guarde una ruta de imagen DEBE agregar aquí su columna (por ejemplo, #17 `fotos_servicio.ruta`).
// Si no, el cron borraría archivos en uso a las 24 horas. Una prueba lo vigila.
export const COLUMNAS_CON_IMAGEN: ColumnaConImagen[] = [
  // Comprobantes de pago (ítem #9).
  { tabla: pagos, columna: pagos.comprobanteRuta },
  // Fotos del servicio (ítem #17).
  { tabla: fotosServicio, columna: fotosServicio.ruta },
];

// Nombres que delatan una columna de ruta de imagen.
const NOMBRE_DE_COLUMNA_DE_RUTA = /(^|_)ruta($|_)|^ruta_imagen$|_ruta_imagen$/;

// Columnas del esquema cuyo nombre parece una ruta de imagen y que no están en el registro.
export function columnasDeRutaSinDeclarar(esquema: Record<string, unknown>, registro: ColumnaConImagen[] = COLUMNAS_CON_IMAGEN): string[] {
  const declaradas = new Set(registro.map((c) => c.columna));
  const faltan: string[] = [];
  for (const valor of Object.values(esquema)) {
    if (!is(valor, PgTable)) continue;
    for (const columna of Object.values(getTableColumns(valor as AnyPgTable))) {
      if (NOMBRE_DE_COLUMNA_DE_RUTA.test(columna.name) && !declaradas.has(columna)) {
        faltan.push(`${getTableName(valor as AnyPgTable)}.${columna.name}`);
      }
    }
  }
  return faltan;
}

// Todas las rutas que alguna fila referencia. Si la consulta falla, el error sube y el cron no borra nada.
export async function leerRutasReferenciadas(
  base: Pick<BaseDatos, "select">,
  columnas: ColumnaConImagen[] = COLUMNAS_CON_IMAGEN,
): Promise<Set<string>> {
  const rutas = new Set<string>();
  for (const { tabla, columna } of columnas) {
    const filas = await base.select({ ruta: columna }).from(tabla);
    for (const fila of filas as { ruta: string | null }[]) if (fila.ruta) rutas.add(fila.ruta);
  }
  return rutas;
}
