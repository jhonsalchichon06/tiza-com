import { describe, expect, it, vi } from "vitest";
import type { AlmacenDeImagenes } from "../imagenes/almacen";
import { crearRutaEntrega } from "../imagenes/entrega";
import type { Usuario } from "../sesion";
import { obtenerComprobante, type PagoParaEntrega } from "./comprobante";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const cliente: Usuario = { id: "u-ana", correo: "ana@tiza.test", nombre: "Ana", celular: "987654321", rol: "cliente" };
const otro: Usuario = { ...cliente, id: "u-otro" };
const admin: Usuario = { ...cliente, id: "u-admin", rol: "admin" };
const ID_PAGO = "7b0c4f1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
const RUTA = "comprobantes/u-ana/yape-AbC.webp";
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

function ruta(opciones: { pagos?: Record<string, PagoParaEntrega>; usuario?: Usuario | null; bytes?: number } = {}) {
  const pagos = opciones.pagos ?? { [ID_PAGO]: { usuarioId: "u-ana", comprobanteRuta: RUTA } };
  const buscar = vi.fn(async (id: string) => pagos[id] ?? null);
  const { almacen, leer } = almacenCon(opciones.bytes ?? 1000);
  const GET = crearRutaEntrega({
    obtenerRecurso: (id, usuario) => obtenerComprobante(id, usuario, buscar),
    sesion: async () => {
      if (opciones.usuario === null) throw (await import("../errores")).ErrorApi.sinSesion();
      return opciones.usuario ?? cliente;
    },
    almacen,
  });
  const pedir = (id: string) => GET(new Request(`http://localhost/api/comprobantes/${id}`), { params: Promise.resolve({ id }) });
  return { pedir, buscar, leer };
}

describe("GET /api/comprobantes/:id", () => {
  it("el dueño recibe 200 con la imagen y las cabeceras privadas", async () => {
    const { pedir } = ruta();
    const r = await pedir(ID_PAGO);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/webp");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("un administrador recibe 200", async () => {
    const { pedir } = ruta({ usuario: admin });
    expect((await pedir(ID_PAGO)).status).toBe(200);
  });

  it("otro cliente recibe 404 y no se lee el archivo", async () => {
    const { pedir, leer } = ruta({ usuario: otro });
    const r = await pedir(ID_PAGO);
    expect(r.status).toBe(404);
    expect(leer).not.toHaveBeenCalled();
  });

  it("un cliente con el mismo id de dueño pero una ruta fuera de su carpeta recibe 404", async () => {
    const { pedir, leer } = ruta({ pagos: { [ID_PAGO]: { usuarioId: "u-ana", comprobanteRuta: "comprobantes/u-otro/x.webp" } } });
    expect((await pedir(ID_PAGO)).status).toBe(404);
    expect(leer).not.toHaveBeenCalled();
  });

  it("un identificador con formato inválido da 404 sin consultar la base", async () => {
    const { pedir, buscar } = ruta();
    const r = await pedir("abc");
    expect(r.status).toBe(404);
    expect(buscar).not.toHaveBeenCalled();
  });

  it("un pago inexistente da 404", async () => {
    const { pedir } = ruta();
    expect((await pedir("00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("un pago con crédito, sin ruta, da 404", async () => {
    const { pedir, leer } = ruta({ pagos: { [ID_PAGO]: { usuarioId: "u-ana", comprobanteRuta: null } } });
    expect((await pedir(ID_PAGO)).status).toBe(404);
    expect(leer).not.toHaveBeenCalled();
  });

  it("sin sesión da 401", async () => {
    const { pedir } = ruta({ usuario: null });
    expect((await pedir(ID_PAGO)).status).toBe(401);
  });

  it("una imagen de 4 MB se entrega completa", async () => {
    const { pedir } = ruta({ bytes: 4 * MB });
    const r = await pedir(ID_PAGO);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-length")).toBe(String(4 * MB));
    expect((await r.arrayBuffer()).byteLength).toBe(4 * MB);
  });
});
