import { crearRutaEntrega } from "@/lib/imagenes/entrega";
import { obtenerComprobante } from "@/lib/pagos/comprobante";

export const GET = crearRutaEntrega({ obtenerRecurso: obtenerComprobante });
