import { ErrorImagen, MENSAJE_SUBIDA, subirImagen } from "../imagenes/cliente";

// Lógica del formulario de subida de fotos (parte del navegador), sin DOM ni red: la subida y el registro se inyectan para
// probarla con dobles. Design de fotos-del-servicio, decisión 6.

// `ruta` ya viene llena si ese archivo se subió en un intento anterior cuyo registro falló: no se vuelve a subir.
export type ItemDeFoto = { clave: string; archivo: File; ambiente: string; ruta?: string };
export type FotoPorRegistrar = { ruta: string; ambiente: string };
export type FotoFallida = { clave: string; motivo: string };

export type ResultadoDelLote = {
  // Claves de los archivos que quedaron registrados: la pantalla los quita de la selección.
  registradas: string[];
  // Los que no subieron, con el motivo: la pantalla los deja con «Reintentar».
  fallidas: FotoFallida[];
};

// El registro falló (por ejemplo 409 por el límite) DESPUÉS de subir: lleva las rutas que sí subieron para reintentar el
// registro sin volver a subir los archivos. Si no se reintenta, esos archivos los limpia el cron de huérfanos en 24 horas.
export class ErrorAlRegistrar extends Error {
  constructor(
    mensaje: string,
    readonly subidas: { clave: string; ruta: string }[],
    readonly causa: unknown,
  ) {
    super(mensaje);
  }
}

export type DependenciasLote = {
  archivos: ItemDeFoto[];
  reservaId: string;
  // Valida, reduce y sube a Blob; devuelve la ruta. Por defecto `subirImagen` de #8 con destino `{ tipo: "foto", reservaId }`.
  subir?: (archivo: File, destino: { tipo: "foto"; reservaId: string }, onProgreso: (porcentaje: number) => void) => Promise<string>;
  // UN solo registro con todas las rutas que subieron bien.
  registrar: (fotos: FotoPorRegistrar[]) => Promise<unknown>;
  concurrencia?: number;
  onProgreso?: (clave: string, porcentaje: number) => void;
};

const subirPorDefecto: NonNullable<DependenciasLote["subir"]> = (archivo, destino, onProgreso) => subirImagen(archivo, { destino, onProgreso });

const motivoDe = (error: unknown) => (error instanceof ErrorImagen ? error.message : MENSAJE_SUBIDA);

// Sube con concurrencia pequeña (el celular o la conexión del administrador pueden ser lentos), junta las rutas que subieron
// bien y hace UN solo registro. Si algunas fallan, registra las que sí subieron y devuelve las fallidas con su motivo. Si todas
// fallan no llama a `registrar`. Si el registro falla, lanza `ErrorAlRegistrar` con las rutas subidas.
export async function subirLote({ archivos, reservaId, subir = subirPorDefecto, registrar, concurrencia = 2, onProgreso }: DependenciasLote): Promise<ResultadoDelLote> {
  const subidas = new Map<string, string>();
  const fallidas: FotoFallida[] = [];
  const pendientes = [...archivos];

  for (const item of archivos) if (item.ruta) subidas.set(item.clave, item.ruta);

  async function trabajador() {
    for (let item = pendientes.shift(); item; item = pendientes.shift()) {
      if (item.ruta) continue;
      try {
        const ruta = await subir(item.archivo, { tipo: "foto", reservaId }, (p) => onProgreso?.(item!.clave, p));
        subidas.set(item.clave, ruta);
      } catch (error) {
        fallidas.push({ clave: item.clave, motivo: motivoDe(error) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrencia, archivos.length || 1)) }, trabajador));

  // Se conserva el orden en que el administrador eligió las fotos.
  const listas = archivos.filter((a) => subidas.has(a.clave));
  if (listas.length === 0) return { registradas: [], fallidas: ordenar(fallidas, archivos) };

  try {
    await registrar(listas.map((a) => ({ ruta: subidas.get(a.clave)!, ambiente: a.ambiente })));
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "No pudimos registrar las fotos.";
    throw new ErrorAlRegistrar(mensaje, listas.map((a) => ({ clave: a.clave, ruta: subidas.get(a.clave)! })), error);
  }
  return { registradas: listas.map((a) => a.clave), fallidas: ordenar(fallidas, archivos) };
}

const ordenar = (fallidas: FotoFallida[], archivos: ItemDeFoto[]) =>
  [...fallidas].sort((a, b) => archivos.findIndex((x) => x.clave === a.clave) - archivos.findIndex((x) => x.clave === b.clave));

// Cuántas fotos más caben: el cupo que queda para el límite. Recorta una selección y dice cuántas dejó fuera.
export function recortarSeleccion<T>(elegidos: T[], caben: number): { aceptados: T[]; sobran: number } {
  const hueco = Math.max(0, caben);
  return { aceptados: elegidos.slice(0, hueco), sobran: Math.max(0, elegidos.length - hueco) };
}

// El formulario solo envía cuando cada foto tiene su ambiente (decisión 6: ambiente obligatorio por foto).
export function faltaAmbiente(archivos: Pick<ItemDeFoto, "ambiente">[]): boolean {
  return archivos.some((a) => !a.ambiente);
}

// Evita el doble clic: mientras una ejecución sigue en curso, las demás llamadas se ignoran (devuelven `undefined`).
export function envioUnico<A extends unknown[], R>(accion: (...args: A) => Promise<R>): (...args: A) => Promise<R | undefined> {
  let enCurso = false;
  return async (...args: A) => {
    if (enCurso) return undefined;
    enCurso = true;
    try {
      return await accion(...args);
    } finally {
      enCurso = false;
    }
  };
}
