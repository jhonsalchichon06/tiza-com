import { ErrorApi, manejar } from "@/lib/errores";

const noEncontrada = manejar(async () => {
  throw ErrorApi.noEncontrado("Esa ruta no existe.");
});

export const GET = noEncontrada;
export const POST = noEncontrada;
export const PUT = noEncontrada;
export const PATCH = noEncontrada;
export const DELETE = noEncontrada;
