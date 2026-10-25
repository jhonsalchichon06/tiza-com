import { obtenerFoto } from "@/lib/fotos/entrega";
import { crearRutaEntrega } from "@/lib/imagenes/entrega";

export const GET = crearRutaEntrega({ obtenerRecurso: obtenerFoto });
