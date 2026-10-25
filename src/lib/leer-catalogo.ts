import { construirCatalogo, type Catalogo } from "./catalogo-publico";
import { leerConfiguracion } from "./configuracion";
import { conReintento } from "./reintento";

// Lectura de solo lectura para las páginas públicas; se regeneran con `revalidate` (ADR 0006: un reintento).
export async function leerCatalogo(): Promise<Catalogo> {
  return construirCatalogo(await conReintento(() => leerConfiguracion()));
}
