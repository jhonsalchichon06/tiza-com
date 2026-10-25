import { describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../errores";
import type { Usuario } from "../sesion";
import type { AlmacenDeImagenes } from "./almacen";
import { autorizarComprobantePorCarpeta, crearRutaEntrega, entregarImagen } from "./entrega";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const MB = 1024 * 1024;
const cliente: Usuario = { id: "u-ana", correo: "ana@correo.com", nombre: "Ana", celular: "987654321", rol: "cliente" };
const otro: Usuario = { ...cliente, id: "u-otro" };
const admin: Usuario = { ...cliente, id: "u-admin", rol: "admin" };
const RUTA = "comprobantes/u-ana/yape-AbC.webp";

function cuerpo(bytes: number) {
  const datos = new Uint8Array(bytes).fill(7);
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(datos);
      c.close();
    },
  });
}

function almacenCon(archivos: Record<string, { tipo: string; bytes: number }>) {
  const leer = vi.fn(async (ruta: string) => {
    const a = archivos[ruta];
    return a ? { cuerpo: cuerpo(a.bytes), tipo: a.tipo, tamano: a.bytes } : null;
  });
  return { almacen: { leer } as Pick<AlmacenDeImagenes, "leer">, leer };
}

const errorDe = (promesa: Promise<unknown>) => promesa.then(() => null, (e: ErrorApi) => e);

describe("autorizarComprobantePorCarpeta", () => {
  it("el dueño y un administrador sí; otro cliente no", () => {
    expect(autorizarComprobantePorCarpeta(cliente, RUTA)).toBe(true);
    expect(autorizarComprobantePorCarpeta(admin, RUTA)).toBe(true);
    expect(autorizarComprobantePorCarpeta(otro, RUTA)).toBe(false);
  });

  it("no se deja engañar por un id que es prefijo de otro", () => {
    expect(autorizarComprobantePorCarpeta({ id: "u-an", rol: "cliente" }, RUTA)).toBe(false);
  });
});

describe("entregarImagen", () => {
  it("el dueño recibe 200 con la imagen y las cabeceras de seguridad", async () => {
    const { almacen } = almacenCon({ [RUTA]: { tipo: "image/webp", bytes: 1000 } });
    const res = await entregarImagen({ ruta: RUTA, usuario: cliente, autorizar: autorizarComprobantePorCarpeta }, almacen);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toBe("inline");
    expect((await res.arrayBuffer()).byteLength).toBe(1000);
  });

  it("un administrador recibe el comprobante de cualquier cliente", async () => {
    const { almacen } = almacenCon({ [RUTA]: { tipo: "image/webp", bytes: 10 } });
    expect((await entregarImagen({ ruta: RUTA, usuario: admin, autorizar: autorizarComprobantePorCarpeta }, almacen)).status).toBe(200);
  });

  it("otro cliente recibe 404 y no se lee Blob", async () => {
    const { almacen, leer } = almacenCon({ [RUTA]: { tipo: "image/webp", bytes: 10 } });
    const error = await errorDe(entregarImagen({ ruta: RUTA, usuario: otro, autorizar: autorizarComprobantePorCarpeta }, almacen));
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error?.status).toBe(404);
    expect(leer).not.toHaveBeenCalled();
  });

  it("un resolvedor que niega da 404 sin leer Blob y uno que autoriza da 200", async () => {
    const { almacen, leer } = almacenCon({ "fotos/r1/a.jpg": { tipo: "image/jpeg", bytes: 10 } });
    expect((await errorDe(entregarImagen({ ruta: "fotos/r1/a.jpg", usuario: cliente, autorizar: async () => false }, almacen)))?.status).toBe(404);
    expect(leer).not.toHaveBeenCalled();
    expect((await entregarImagen({ ruta: "fotos/r1/a.jpg", usuario: cliente, autorizar: async () => true }, almacen)).status).toBe(200);
  });

  it("entrega una imagen de 4 MB completa", async () => {
    const { almacen } = almacenCon({ [RUTA]: { tipo: "image/png", bytes: 4 * MB } });
    const res = await entregarImagen({ ruta: RUTA, usuario: cliente, autorizar: autorizarComprobantePorCarpeta }, almacen);
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(4 * MB);
  });

  it("no redirige ni expone una URL de Blob", async () => {
    const { almacen } = almacenCon({ [RUTA]: { tipo: "image/webp", bytes: 10 } });
    const res = await entregarImagen({ ruta: RUTA, usuario: cliente, autorizar: autorizarComprobantePorCarpeta }, almacen);
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).not.toBe(302);
    expect([...res.headers.values()].join(" ")).not.toMatch(/blob\.vercel|vercel-storage/i);
  });

  it("si el archivo ya no existe da 404 aunque el permiso sea válido", async () => {
    const { almacen } = almacenCon({});
    expect((await errorDe(entregarImagen({ ruta: RUTA, usuario: cliente, autorizar: autorizarComprobantePorCarpeta }, almacen)))?.status).toBe(404);
  });

  it("si Blob declarara un tipo que no es imagen, no se muestra en línea", async () => {
    const { almacen } = almacenCon({ [RUTA]: { tipo: "text/html", bytes: 10 } });
    const res = await entregarImagen({ ruta: RUTA, usuario: cliente, autorizar: autorizarComprobantePorCarpeta }, almacen);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toBe("attachment");
  });
});

describe("crearRutaEntrega", () => {
  const ruta = (usuario: Usuario | null, recursos: Record<string, string>) => {
    const { almacen } = almacenCon({ [RUTA]: { tipo: "image/webp", bytes: 100 } });
    return crearRutaEntrega({
      sesion: async () => {
        if (!usuario) throw ErrorApi.sinSesion();
        return usuario;
      },
      obtenerRecurso: async (id) => (recursos[id] ? { ruta: recursos[id], autorizar: autorizarComprobantePorCarpeta } : null),
      almacen,
    });
  };
  const pedir = (r: ReturnType<typeof ruta>, id: string) =>
    r(new Request(`http://localhost:3000/api/comprobantes/${id}`), { params: Promise.resolve({ id }) });

  it("sin sesión da 401", async () => {
    expect((await pedir(ruta(null, { p1: RUTA }), "p1")).status).toBe(401);
  });

  it("el dueño recibe 200, otro cliente 404 y un recurso inexistente 404", async () => {
    expect((await pedir(ruta(cliente, { p1: RUTA }), "p1")).status).toBe(200);
    expect((await pedir(ruta(otro, { p1: RUTA }), "p1")).status).toBe(404);
    expect((await pedir(ruta(cliente, {}), "p9")).status).toBe(404);
  });

  it("el 404 de otro cliente es idéntico al de un recurso que no existe", async () => {
    const ajeno = await pedir(ruta(otro, { p1: RUTA }), "p1");
    const inexistente = await pedir(ruta(otro, {}), "p9");
    expect(await ajeno.json()).toEqual(await inexistente.json());
  });
});
