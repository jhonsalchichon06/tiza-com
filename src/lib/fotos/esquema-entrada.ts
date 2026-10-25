import { z } from "zod";
import { AMBIENTES } from "./ambientes";

export const MENSAJE_FOTOS = "Envía al menos una foto.";
export const MENSAJE_RUTA = "La ruta de la foto no es válida.";
export const MENSAJE_AMBIENTE = "Elige el ambiente de cada foto.";

// Cuerpo de POST /api/admin/reservas/:id/fotos: de 1 a `max` fotos, cada una con la ruta que devolvió la subida a Blob y un
// ambiente de la lista cerrada. `max` es `fotos_maximas_por_reserva` (dato de `configuracion`, nunca un número escrito aquí).
// Zod descarta las claves que no declara. El conteo contra las fotos que ya tiene la reserva se hace en la transacción.
export function crearEsquemaFotos(max: number) {
  return z.object(
    {
      fotos: z
        .array(
          z.object(
            {
              ruta: z.string({ error: MENSAJE_RUTA }).min(1, { error: MENSAJE_RUTA }).max(300, { error: MENSAJE_RUTA }),
              ambiente: z.enum(AMBIENTES, { error: MENSAJE_AMBIENTE }),
            },
            { error: MENSAJE_FOTOS },
          ),
          { error: MENSAJE_FOTOS },
        )
        .min(1, { error: MENSAJE_FOTOS })
        .max(max, { error: `Puedes subir hasta ${max} fotos por envío.` }),
    },
    { error: MENSAJE_FOTOS },
  );
}

export type CuerpoFotos = z.infer<ReturnType<typeof crearEsquemaFotos>>;
