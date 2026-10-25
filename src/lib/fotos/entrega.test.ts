import { describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../errores";
import type { AlmacenDeImagenes } from "../imagenes/almacen";
import { crearRutaEntrega } from "../imagenes/entrega";
import type { Usuario } from "../sesion";
import { obtenerFoto, type FotoParaEntrega } from "./entrega";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const cliente: Usuario = { id: "u-ana", correo: "ana@tiza.test", nombre: "Ana", celular: "987654321", rol: "cliente" };
const otro: Usuario = { ...cliente, id: "u-otro" };
const admin: Usuario = { ...cliente, id: "u-admin", rol: "admin" };
const ID_FOTO = "7b0c4f1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
const RESERVA = "11111111-1111-4111-8111-111111111111";
const OTRA_RESERVA = "22222222-2222-4222-8222-222222222222";
const RUTA = `fotos/${RESERVA}/1700000000.webp`;
const MB = 1024 * 1024;

function almacenCon(bytes: number) {
  const leer = vi.fn(async (ruta: string) => {
    if (ruta !== RUTA) return null;
    const datos = new Uint8Array(bytes).fill(7);
    const cuerpo = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(datos);
        c.close();
      },
    });
    return { cuerpo, tipo: "image/webp", tamano: bytes };
  });
  return { almacen: { leer } as Pick<AlmacenDeImagenes, "leer">, leer };
}

function ruta(opciones: { fotos?: Record<string, FotoParaEntrega>; usuario?: Usuario | null; bytes?: number } = {}) {
  const fotos = opciones.fotos ?? { [ID_FOTO]: { ruta: RUTA, reservaId: RESERVA, usuarioId: "u-ana" } };
  const buscar = vi.fn(async (id: string) => fotos[id] ?? null);
  const { almacen, leer } = almacenCon(opciones.bytes ?? 1000);
  // Igual que app/api/fotos/[id]/route.ts, con la base y el almacén simulados.
  const GET = crearRutaEntrega({
    obtenerRecurso: (id, usuario) => obtenerFoto(id, usuario, buscar),
    sesion: async () => {
      if (opciones.usuario === null) throw ErrorApi.sinSesion();
      return opciones.usuario ?? cliente;
    },
    almacen,
  });
  const pedir = (id: string) => GET(new Request(`http://localhost/api/fotos/${id}`), { params: Promise.resolve({ id }) });
  return { pedir, buscar, leer };
}

describe("GET /api/fotos/:id", () => {
  it("el dueño de la reserva recibe 200 con la imagen en el cuerpo y las cabeceras privadas", async () => {
    const { pedir } = ruta();
    const r = await pedir(ID_FOTO);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/webp");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-disposition")).toBe("inline");
    expect(r.headers.get("location")).toBeNull();
    expect((await r.arrayBuffer()).byteLength).toBe(1000);
  });

  it("un administrador recibe 200 aunque la foto sea de otro cliente", async () => {
    const { pedir } = ruta({ usuario: admin });
    expect((await pedir(ID_FOTO)).status).toBe(200);
  });

  it("otro cliente recibe 404 y no se lee Blob", async () => {
    const { pedir, leer } = ruta({ usuario: otro });
    const r = await pedir(ID_FOTO);
    expect(r.status).toBe(404);
    expect(leer).not.toHaveBeenCalled();
  });

  it("el 404 de una foto ajena es idéntico al de un id inexistente", async () => {
    const { pedir } = ruta({ usuario: otro });
    const ajena = await pedir(ID_FOTO);
    const inexistente = await pedir("99999999-9999-4999-8999-999999999999");
    expect(inexistente.status).toBe(404);
    expect(await ajena.json()).toEqual(await inexistente.json());
  });

  it("sin sesión: 401", async () => {
    const { pedir, buscar } = ruta({ usuario: null });
    expect((await pedir(ID_FOTO)).status).toBe(401);
    expect(buscar).not.toHaveBeenCalled();
  });

  it("un id que no es uuid: 404 sin consultar la base", async () => {
    const { pedir, buscar } = ruta();
    expect((await pedir("abc")).status).toBe(404);
    expect(buscar).not.toHaveBeenCalled();
  });

  it("una foto de 4 MB se entrega completa y sin Location", async () => {
    const { pedir } = ruta({ bytes: 4 * MB });
    const r = await pedir(ID_FOTO);
    expect(r.status).toBe(200);
    expect(r.headers.get("location")).toBeNull();
    expect((await r.arrayBuffer()).byteLength).toBe(4 * MB);
  });

  it("dato corrupto: la ruta guardada es de la carpeta de otra reserva y quien la pide es el dueño: 404 sin leer Blob", async () => {
    const { pedir, leer } = ruta({ fotos: { [ID_FOTO]: { ruta: `fotos/${OTRA_RESERVA}/x.webp`, reservaId: RESERVA, usuarioId: "u-ana" } } });
    expect((await pedir(ID_FOTO)).status).toBe(404);
    expect(leer).not.toHaveBeenCalled();
  });

  it("una foto cuyo archivo ya no está en Blob: 404", async () => {
    const { pedir } = ruta({ fotos: { [ID_FOTO]: { ruta: `fotos/${RESERVA}/borrada.webp`, reservaId: RESERVA, usuarioId: "u-ana" } } });
    expect((await pedir(ID_FOTO)).status).toBe(404);
  });
});

describe("obtenerFoto", () => {
  it("reintenta una vez ante un corte de conexión (también envuelto por Drizzle)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    const buscar = vi.fn(async () => {
      if (++n === 1) throw Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("terminated"), { code: "ECONNRESET" }) });
      return { ruta: RUTA, reservaId: RESERVA, usuarioId: "u-ana" };
    });
    const recurso = await obtenerFoto(ID_FOTO, cliente, buscar);
    expect(recurso?.ruta).toBe(RUTA);
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("no devuelve nada para una foto inexistente", async () => {
    expect(await obtenerFoto(ID_FOTO, cliente, async () => null)).toBeNull();
  });

  it("autorizar: el dueño con su carpeta sí; el dueño con otra carpeta no; otro cliente no; el administrador siempre", async () => {
    const recurso = (await obtenerFoto(ID_FOTO, cliente, async () => ({ ruta: RUTA, reservaId: RESERVA, usuarioId: "u-ana" })))!;
    expect(await recurso.autorizar(cliente, RUTA)).toBe(true);
    expect(await recurso.autorizar(cliente, `fotos/${OTRA_RESERVA}/x.webp`)).toBe(false);
    expect(await recurso.autorizar(otro, RUTA)).toBe(false);
    expect(await recurso.autorizar(admin, RUTA)).toBe(true);
  });
});
