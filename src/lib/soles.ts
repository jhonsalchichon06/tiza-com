// Formato de montos y horas para mostrar lo que ya calculó el servidor (ADR 0008). No calcula precios.
// Los montos llegan en céntimos enteros; la coma decimal se escribe a mano para no depender de la configuración
// regional del dispositivo.

export function formatearSoles(centimos: number): string {
  const negativo = centimos < 0;
  const total = Math.abs(Math.round(centimos));
  const soles = Math.floor(total / 100);
  const resto = total % 100;
  const enteros = String(soles).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const texto = resto === 0 ? enteros : `${enteros},${String(resto).padStart(2, "0")}`;
  return `${negativo ? "-" : ""}S/ ${texto}`;
}

// 1 → "1 hora", 3 → "3 horas", 3,5 → "3,5 horas".
export function formatearHoras(horas: number): string {
  const numero = String(horas).replace(".", ",");
  return `${numero} ${horas === 1 ? "hora" : "horas"}`;
}
