import { describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../errores";
import type { Usuario } from "../sesion";
import { crearRutaSubidas } from "./subidas";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const cliente: Usuario = { id: "u-ana", correo: "ana@correo.com", nombre: "Ana", celular: "987654321", rol: "cliente" };
const admin: Usuario = { ...cliente, id: "u-admin", rol: "admin" };

// Almacén doble: llama a onBeforeGenerateToken como lo hace handleUpload y devuelve las opciones que pidió el servidor.
type Opciones = Record<string, unknown>;
function almacenDoble() {
  const emitidos: { pathname: string; opciones: Opciones; token: string }[] = [];
  const almacen = vi.fn(async ({ body, token, onBeforeGenerateToken }: Record<string, any>) => {
    const { pathname, clientPayload, multipart } = body.payload;
    const opciones = await onBeforeGenerateToken(pathname, clientPayload, multipart);
    emitidos.push({ pathname, opciones, token });
    return { type: "blob.generate-client-token" as const, clientToken: "token-de-prueba" };
  });
  return { almacen: almacen as never, emitidos, llamadas: almacen };
}

const solicitud = (ruta: string) => ({ type: "blob.generate-client-token", payload: { pathname: ruta, clientPayload: null, multipart: false } });
const post = (cuerpo: unknown, tipo = "application/json") =>
  new Request("http://localhost:3000/api/subidas", { method: "POST", headers: { "content-type": tipo }, body: JSON.stringify(cuerpo) });

function ruta(usuario: Usuario | null, extra: Partial<Parameters<typeof crearRutaSubidas>[0]> = {}) {
  const doble = almacenDoble();
  const handler = crearRutaSubidas({
    sesion: async () => {
      if (!usuario) throw ErrorApi.sinSesion();
      return usuario;
    },
    almacen: doble.almacen,
    leerToken: () => "vercel_blob_rw_prueba",
    ...extra,
  });
  return { handler, ...doble };
}

describe("POST /api/subidas", () => {
  it("responde 401 sin sesión y no emite ningún token", async () => {
    const { handler, llamadas } = ruta(null);
    const res = await handler(post(solicitud("comprobantes/u-ana/a.webp")));
    expect(res.status).toBe(401);
    expect((await res.json()).error.codigo).toBe("sin_sesion");
    expect(llamadas).not.toHaveBeenCalled();
  });

  it("emite un token solo para la carpeta del usuario, con los tres tipos y 4 MB", async () => {
    const { handler, emitidos } = ruta(cliente);
    const res = await handler(post(solicitud("comprobantes/u-ana/yape.webp")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: "blob.generate-client-token", clientToken: "token-de-prueba" });
    expect(emitidos).toHaveLength(1);
    expect(emitidos[0].opciones).toMatchObject({
      allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
      maximumSizeInBytes: 4 * 1024 * 1024,
      addRandomSuffix: true,
    });
    expect(emitidos[0].token).toBe("vercel_blob_rw_prueba");
  });

  it.each([
    ["la carpeta de otro usuario", "comprobantes/u-otro/a.webp"],
    ["un recorrido con ..", "comprobantes/u-ana/../u-otro/a.webp"],
    ["una extensión .gif", "comprobantes/u-ana/a.gif"],
    ["una ruta fuera de las carpetas", "otros/u-ana/a.webp"],
  ])("responde 422 con %s y no emite token", async (_nombre, destino) => {
    const { handler, emitidos } = ruta(cliente);
    const res = await handler(post(solicitud(destino)));
    expect(res.status).toBe(422);
    expect(emitidos).toHaveLength(0);
  });

  it("responde 403 a un cliente que pide la carpeta de fotos", async () => {
    const { handler, emitidos } = ruta(cliente);
    const res = await handler(post(solicitud("fotos/res_1/a.webp")));
    expect(res.status).toBe(403);
    expect(emitidos).toHaveLength(0);
  });

  it("emite un token de fotos para un administrador", async () => {
    const { handler, emitidos } = ruta(admin);
    const res = await handler(post(solicitud("fotos/res_1/cocina.jpg")));
    expect(res.status).toBe(200);
    expect(emitidos[0].pathname).toBe("fotos/res_1/cocina.jpg");
  });

  it("un administrador no puede usar la carpeta de comprobantes de otro", async () => {
    const { handler } = ruta(admin);
    expect((await handler(post(solicitud("comprobantes/u-ana/a.webp")))).status).toBe(422);
  });

  it("responde 503 con 'Inténtalo en unos segundos.' si falta BLOB_READ_WRITE_TOKEN y lo registra", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler, llamadas } = ruta(cliente, {
      leerToken: () => {
        throw new Error("Falta configurar la variable de entorno: BLOB_READ_WRITE_TOKEN");
      },
    });
    const res = await handler(post(solicitud("comprobantes/u-ana/a.webp")));
    expect(res.status).toBe(503);
    const cuerpo = await res.text();
    expect(JSON.parse(cuerpo).error.mensaje).toBe("Inténtalo en unos segundos.");
    expect(cuerpo).not.toContain("BLOB_READ_WRITE_TOKEN");
    expect(log).toHaveBeenCalled();
    expect(llamadas).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("responde 415 si no se envía JSON y 422 si el cuerpo no es un evento", async () => {
    const { handler } = ruta(cliente);
    expect((await handler(post({}, "text/plain"))).status).toBe(415);
    expect((await handler(post({ hola: "mundo" }))).status).toBe(422);
    expect((await handler(post("texto"))).status).toBe(422);
    const roto = new Request("http://localhost:3000/api/subidas", { method: "POST", headers: { "content-type": "application/json" }, body: "{no es json" });
    expect((await handler(roto)).status).toBe(422);
  });

  it("un error inesperado del almacén sale como 500 genérico sin detalles", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler } = ruta(cliente, {
      almacen: (async () => {
        throw new Error("secreto interno de Blob");
      }) as never,
    });
    const res = await handler(post(solicitud("comprobantes/u-ana/a.webp")));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secreto interno");
    log.mockRestore();
  });
});
