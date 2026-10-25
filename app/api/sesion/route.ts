import { crearRutasSesion } from "@/lib/rutas-sesion";

const rutas = crearRutasSesion();

export const POST = rutas.iniciar;
export const GET = rutas.actual;
export const DELETE = rutas.cerrar;
