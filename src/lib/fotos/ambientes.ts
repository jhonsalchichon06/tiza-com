// Ambientes en que se clasifica cada foto del servicio. SUPUESTO del diseño de `fotos-del-servicio` (el PRD solo dice
// «ambiente»), no confirmado por el negocio. No hay CHECK en la base: la lista la valida el servidor y puede cambiar editando
// este archivo, sin migración. Ni el servidor ni el navegador deben escribir esta lista en otro lugar.
export const AMBIENTES = ["cocina", "bano", "dormitorio", "sala", "comedor", "lavanderia", "otro"] as const;

export type Ambiente = (typeof AMBIENTES)[number];

export const ETIQUETAS_DE_AMBIENTE: Record<Ambiente, string> = {
  cocina: "Cocina",
  bano: "Baño",
  dormitorio: "Dormitorio",
  sala: "Sala",
  comedor: "Comedor",
  lavanderia: "Lavandería",
  otro: "Otro",
};

export function esAmbiente(valor: unknown): valor is Ambiente {
  return typeof valor === "string" && (AMBIENTES as readonly string[]).includes(valor);
}

export function etiquetaDeAmbiente(ambiente: string): string {
  return esAmbiente(ambiente) ? ETIQUETAS_DE_AMBIENTE[ambiente] : "Otro";
}
