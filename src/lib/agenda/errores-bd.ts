const EXCLUSION_VIOLADA = "23P01";

const codigoDe = (valor: unknown): unknown =>
  typeof valor === "object" && valor !== null ? (valor as { code?: unknown }).code : undefined;

// Drizzle envuelve el error de la base en `DrizzleQueryError`; el código SQLSTATE queda en `cause`.
export function esConflictoDeExclusion(error: unknown): boolean {
  if (codigoDe(error) === EXCLUSION_VIOLADA) return true;
  const causa = typeof error === "object" && error !== null ? (error as { cause?: unknown }).cause : undefined;
  return codigoDe(causa) === EXCLUSION_VIOLADA;
}

// Para decidir si reintentar: `esErrorDeConexion` solo mira el error de nivel superior, así que se le da
// el original que Drizzle dejó en `cause` cuando existe.
export function errorOriginal(error: unknown): unknown {
  if (typeof error === "object" && error !== null) {
    const causa = (error as { cause?: unknown }).cause;
    if (typeof causa === "object" && causa !== null) return causa;
  }
  return error;
}
