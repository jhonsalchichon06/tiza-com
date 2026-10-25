// Los 9 distritos de v1 (PRD, "Distritos de v1"). Ampliar la lista exige antes cambiar el PRD.
export const DISTRITOS = [
  "Barranco",
  "Jesús María",
  "Lince",
  "Miraflores",
  "San Borja",
  "San Isidro",
  "San Luis",
  "San Miguel",
  "Santiago de Surco",
] as const;

export type Distrito = (typeof DISTRITOS)[number];

export function esDistrito(valor: unknown): valor is Distrito {
  return typeof valor === "string" && (DISTRITOS as readonly string[]).includes(valor);
}
