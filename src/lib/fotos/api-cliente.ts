import type { FotoPorRegistrar } from "./subir-lote";

export type Pedir = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export const MENSAJE_SIN_RESPUESTA = "No pudimos registrar las fotos. Revisa tu internet e inténtalo de nuevo.";

// Parte del navegador: un solo POST con las rutas que ya subieron a Blob. Si el servidor responde con error lanza un Error con
// SU mensaje (409 por el límite, 422 por un archivo inválido…) para mostrarlo tal cual.
export async function registrarFotosPorHttp(
  reservaId: string,
  fotos: FotoPorRegistrar[],
  pedir: Pedir = (url, init) => fetch(url, init),
): Promise<{ id: string; ambiente: string }[]> {
  let respuesta;
  try {
    respuesta = await pedir(`/api/admin/reservas/${encodeURIComponent(reservaId)}/fotos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fotos }),
    });
  } catch {
    throw new Error(MENSAJE_SIN_RESPUESTA);
  }
  const cuerpo = (await respuesta.json().catch(() => null)) as unknown;
  if (!respuesta.ok) {
    const mensaje = (cuerpo as { error?: { mensaje?: unknown } } | null)?.error?.mensaje;
    throw new Error(typeof mensaje === "string" ? mensaje : MENSAJE_SIN_RESPUESTA);
  }
  return cuerpo as { id: string; ambiente: string }[];
}
