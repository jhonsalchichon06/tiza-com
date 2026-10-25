import { esDistrito, type Distrito } from "@/lib/distritos";

// Parámetros que envía la landing a /reservar (`distrito`, `tipo`, `horas`, `club`). Todo lo inválido se ignora:
// la URL la puede escribir cualquiera y el asistente debe arrancar sin error.

export type ParametrosDeUrl = Record<string, string | string[] | undefined>;
export type TipoDeServicio = "estandar" | "profunda" | "mudanza" | "paquete";

export type ParametrosIniciales = {
  distrito: Distrito | "";
  tipo: TipoDeServicio | null;
  horas: number | null;
};

const TIPOS_DE_TAMANO = ["estandar", "profunda", "mudanza"] as const;

const primero = (valor: string | string[] | undefined): string | undefined => (Array.isArray(valor) ? valor[0] : valor);

// `paquetesValidos` son las horas de los paquetes de la configuración: `horas=5` no vale si no existe ese paquete.
// `tipo=horas` de la landing se traduce a `paquete`. `club` se acepta y no cambia nada: todo cliente nuevo paga la membresía.
export function leerParametrosIniciales(parametros: ParametrosDeUrl, paquetesValidos: readonly number[]): ParametrosIniciales {
  const distrito = primero(parametros.distrito)?.trim();
  const tipoCrudo = primero(parametros.tipo)?.trim();

  let tipo: TipoDeServicio | null = null;
  if (tipoCrudo === "horas") tipo = "paquete";
  else if ((TIPOS_DE_TAMANO as readonly string[]).includes(tipoCrudo ?? "")) tipo = tipoCrudo as TipoDeServicio;

  let horas: number | null = null;
  const horasCrudas = primero(parametros.horas)?.trim();
  if (tipo === "paquete" && horasCrudas && /^\d+(\.\d+)?$/.test(horasCrudas)) {
    const candidato = Number(horasCrudas);
    if (paquetesValidos.includes(candidato)) horas = candidato;
  }

  return { distrito: esDistrito(distrito) ? distrito : "", tipo, horas };
}

// Ruta a la que vuelve el cliente después de registrarse o iniciar sesión, con los mismos parámetros.
export function rutaDeVolver(parametros: ParametrosDeUrl): string {
  const consulta = new URLSearchParams();
  for (const [clave, valor] of Object.entries(parametros)) {
    if (valor === undefined) continue;
    for (const v of Array.isArray(valor) ? valor : [valor]) consulta.append(clave, v);
  }
  const texto = consulta.toString();
  return texto ? `/reservar?${texto}` : "/reservar";
}
