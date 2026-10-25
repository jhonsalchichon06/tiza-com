import { db } from "@/db/cliente";
import { leerConfiguracion, type Configuracion } from "../configuracion";
import { cerrarMembresiasSinReenvio } from "../pagos/cierre";
import { expirarVencidas, type BaseDatos } from "./expirar";

export type ResultadoPasada = { reservas: string[]; membresias: string[] };

// Pasada de expiración confiable (design de revision-de-pagos-admin, decisión 5). `transaccionDeEscritura` marca las
// vencidas dentro de la transacción de cada escritura, pero si esa escritura falla (409, 422) el ROLLBACK deshace también
// la marca. Esta pasada abre SU PROPIA transacción y la confirma: persiste lo que las lecturas ya calculan con
// `reservaActiva`. Marca las reservas `pendiente` vencidas y cierra las membresías cuyo plazo de reenvío terminó.
//
// Va en una transacción (y no en una sentencia suelta) porque el ítem 14 extiende `expirarVencidas` con más sentencias
// (devolver horas de crédito) que deben ser atómicas con la marca. Los ítems 12 y 16 la llaman al abrir el perfil y la
// agenda. Sin reintento propio: la ruta que la llama la envuelve en `conReintento`.
export async function ejecutarPasadaDeExpiracion(
  base: Pick<BaseDatos, "transaction"> = db(),
  leerConfig: () => Promise<Pick<Configuracion, "reenvio_comprobante_dias">> = () => leerConfiguracion(),
): Promise<ResultadoPasada> {
  const { reenvio_comprobante_dias: dias } = await leerConfig();
  return base.transaction(async (tx) => {
    const reservas = await expirarVencidas(tx);
    const membresias = await cerrarMembresiasSinReenvio(tx, dias);
    return { reservas, membresias };
  });
}
