import { almacenDeBlob, type AlmacenDeImagenes } from "./almacen";
import { HORAS_ANTES_DE_BORRAR_HUERFANOS } from "./tipos";

export type ResultadoLimpieza = { omitido: boolean; revisados: number; borrados: number; fallidos: number };

type Entrada = {
  almacen?: Pick<AlmacenDeImagenes, "listar" | "borrar">;
  // Rutas que alguna fila referencia. Si falla, la limpieza aborta sin borrar nada.
  leerReferencias: () => Promise<Set<string>>;
  // Cuántas columnas hay declaradas en el registro: con 0 no se borra nada (ADR 0010).
  columnasDeclaradas: number;
  ahora?: Date;
};

const CARPETAS = ["comprobantes/", "fotos/"];

// Borra los archivos de Blob que se subieron hace más de 24 horas y ninguna fila usa. Lo reciente no se toca
// (su reserva puede estar por crearse) y lo referenciado no se borra nunca, sin importar la antigüedad.
export async function limpiarHuerfanos({
  almacen = almacenDeBlob,
  leerReferencias,
  columnasDeclaradas,
  ahora = new Date(),
}: Entrada): Promise<ResultadoLimpieza> {
  if (columnasDeclaradas === 0) return { omitido: true, revisados: 0, borrados: 0, fallidos: 0 };

  // Primero las referencias: si la lectura falla, el error sube y no se ha borrado nada. Un archivo creado después
  // de esta lectura tiene menos de 24 horas y no es candidato, así que no hay carrera.
  const referenciadas = await leerReferencias();
  const limite = ahora.getTime() - HORAS_ANTES_DE_BORRAR_HUERFANOS * 3_600_000;
  const resultado: ResultadoLimpieza = { omitido: false, revisados: 0, borrados: 0, fallidos: 0 };

  for (const prefijo of CARPETAS) {
    let cursor: string | undefined;
    do {
      const pagina = await almacen.listar({ prefijo, cursor });
      for (const elemento of pagina.elementos) {
        resultado.revisados++;
        if (elemento.subidoEn.getTime() >= limite) continue; // 24 h o menos: todavía puede usarse
        if (referenciadas.has(elemento.ruta)) continue;
        try {
          await almacen.borrar(elemento.ruta);
          resultado.borrados++;
        } catch (error) {
          resultado.fallidos++;
          console.error("No se pudo borrar un archivo huérfano de Blob:", elemento.ruta, error);
        }
      }
      cursor = pagina.hayMas ? pagina.cursor : undefined;
    } while (cursor);
  }
  return resultado;
}
