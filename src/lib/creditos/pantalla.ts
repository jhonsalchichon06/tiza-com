import { db } from "@/db/cliente";
import { ejecutarPasadaDeExpiracion } from "../agenda/pasada";
import { errorOriginal } from "../agenda/errores-bd";
import { leerConfiguracion } from "../configuracion";
import { ErrorApi } from "../errores";
import { conReintento } from "../reintento";
import { leerCreditos, type CreditosVista } from "./consulta";

// Lo que lee la página /cuenta/credito (servidor, sin pasar por HTTP): la misma pasada de expiración y la misma consulta que
// `GET /api/creditos`, con un reintento si Neon estaba dormido. Cada consulta lleva el `usuario_id` de la sesión.
export async function leerCreditosParaPagina(usuarioId: string): Promise<{ creditos: CreditosVista; zona: string }> {
  return conReintento(async () => {
    try {
      await ejecutarPasadaDeExpiracion();
      const zona = (await leerConfiguracion()).horario_atencion.zona;
      return { creditos: await leerCreditos(db(), usuarioId, zona), zona };
    } catch (error) {
      throw error instanceof ErrorApi ? error : errorOriginal(error);
    }
  });
}
