// Destino tras iniciar sesión: solo rutas internas, para no abrir una redirección hacia otro sitio.
export function destinoSeguro(volver: string | null | undefined, porDefecto = "/cuenta"): string {
  if (!volver || !volver.startsWith("/") || volver.startsWith("//") || volver.startsWith("/\\")) {
    return porDefecto;
  }
  return volver;
}
