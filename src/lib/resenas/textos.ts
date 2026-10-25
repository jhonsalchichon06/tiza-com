export type EstadoResena = "pendiente" | "aprobada" | "rechazada";

// Textos del estado de una reseña para el cliente (propuestas del design de `resenas`; ajustarlos no cambia las specs).
const TEXTOS: Record<EstadoResena, string> = {
  pendiente: "En revisión: aún no se muestra en la web",
  aprobada: "Publicada en la web",
  rechazada: "No se publicó. Puedes editarla y enviarla de nuevo",
};

export const textoDeEstadoResena = (estado: EstadoResena): string => TEXTOS[estado];

// Una aprobada ya no se edita: si se pudiera, el texto cambiaría después de que el administrador lo aprobó.
export const esEditable = (estado: EstadoResena): boolean => estado !== "aprobada";
