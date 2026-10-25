// Reparto del crédito en horas entre lotes (ADR 0012). Funciones puras: no tocan la base. Las horas son múltiplos de 0,5; se
// trabaja en medias horas enteras para que 0,1 + 0,2 no ensucie los resultados.

export type LoteParaRepartir = { id: string; venceEn: Date; horasDisponibles: number };
export type Reparto = { creditoId: string; horas: number };

const aMedias = (horas: number) => Math.round(horas * 2);
const deMedias = (medias: number) => medias / 2;

// Ordena los lotes por vencimiento (el que vence antes primero) y, a igualdad, por id; luego toma `horas` de ellos sin
// pasarse de lo disponible en cada uno. Devuelve el reparto y el sobrante que los lotes no alcanzaron a cubrir.
export function repartirCredito(lotes: LoteParaRepartir[], horas: number): { reparto: Reparto[]; sobrante: number } {
  const ordenados = [...lotes].sort((a, b) => a.venceEn.getTime() - b.venceEn.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let faltan = Math.max(0, aMedias(horas));
  const reparto: Reparto[] = [];
  for (const lote of ordenados) {
    if (faltan === 0) break;
    const tomar = Math.min(faltan, Math.max(0, aMedias(lote.horasDisponibles)));
    if (tomar === 0) continue;
    reparto.push({ creditoId: lote.id, horas: deMedias(tomar) });
    faltan -= tomar;
  }
  return { reparto, sobrante: deMedias(faltan) };
}

// Horas de trabajo que se pagan en dinero: el servicio menos las horas gratis y menos el crédito aplicado (mínimo 0).
export function horasPagadasEnDinero({
  horasTrabajo,
  horasGratis,
  creditoAplicado,
}: {
  horasTrabajo: number;
  horasGratis: number;
  creditoAplicado: number;
}): number {
  return deMedias(Math.max(0, aMedias(horasTrabajo) - aMedias(horasGratis) - aMedias(creditoAplicado)));
}
