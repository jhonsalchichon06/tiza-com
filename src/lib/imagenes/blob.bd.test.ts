import { config } from "dotenv";
import { put } from "@vercel/blob";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { almacenDeBlob, type AlmacenDeImagenes } from "./almacen";
import { autorizarComprobantePorCarpeta, entregarImagen } from "./entrega";
import { limpiarHuerfanos } from "./huerfanos";
import { crearRutaSubidas } from "./subidas";
import { verificarImagenSubida } from "./verificar";

config({ path: ".env.local", quiet: true });

// Pruebas contra la tienda REAL de Blob (privada). Solo corren con PRUEBAS_BD=1 y con el token configurado.
// Todo lo que suben vive bajo un prefijo único y se borra en afterAll; el cron simulado se limita a ese prefijo.
const ACTIVAS = process.env.PRUEBAS_BD === "1" && Boolean(process.env.BLOB_READ_WRITE_TOKEN);

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const WEBP = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");

describe.skipIf(!ACTIVAS)("Vercel Blob real: verificación, entrega y limpieza", () => {
  const id = crypto.randomUUID().slice(0, 8);
  const usuario = { id: `prueba-imagenes-${id}`, rol: "cliente" as const };
  const otro = { id: "prueba-imagenes-otro", rol: "cliente" as const };
  const admin = { id: "prueba-imagenes-admin", rol: "admin" as const };
  const carpeta = `comprobantes/${usuario.id}/`;
  const rutas: Record<string, string> = {};

  const subir = async (nombre: string, cuerpo: Buffer, tipo: string) => {
    const r = await put(`${carpeta}${nombre}`, cuerpo, { access: "private", contentType: tipo, addRandomSuffix: true });
    return r.pathname;
  };

  // Mismo almacén, pero la limpieza solo ve lo de esta prueba: nunca toca archivos ajenos.
  const almacenAcotado: Pick<AlmacenDeImagenes, "listar" | "borrar"> = {
    listar: ({ prefijo, cursor }) => almacenDeBlob.listar({ prefijo: prefijo === "comprobantes/" ? carpeta : `fotos/${usuario.id}/`, cursor }),
    borrar: (ruta) => almacenDeBlob.borrar(ruta),
  };

  beforeAll(async () => {
    rutas.png = await subir("comprobante.png", PNG, "image/png");
    rutas.webp = await subir("comprobante.webp", WEBP, "image/webp");
    rutas.falso = await subir("falso.png", PDF, "image/png");
    expect(rutas.png.startsWith(carpeta)).toBe(true);
    expect(rutas.png).not.toBe(`${carpeta}comprobante.png`); // el sufijo aleatorio se agregó
  });

  afterAll(async () => {
    const pagina = await almacenDeBlob.listar({ prefijo: carpeta });
    for (const e of pagina.elementos) await almacenDeBlob.borrar(e.ruta);
    const resto = await almacenDeBlob.listar({ prefijo: carpeta });
    expect(resto.elementos).toHaveLength(0); // no queda nada de la prueba
  });

  it("metadatos: tamaño de un archivo existente y null para uno inexistente", async () => {
    expect((await almacenDeBlob.metadatos(rutas.png))?.tamano).toBe(PNG.length);
    expect(await almacenDeBlob.metadatos(`${carpeta}no-existe.png`)).toBeNull();
  });

  it("leerInicio devuelve solo los primeros bytes", async () => {
    const inicio = await almacenDeBlob.leerInicio(rutas.png, 12);
    expect(inicio && Buffer.from(inicio).equals(PNG.subarray(0, 12))).toBe(true);
    expect(await almacenDeBlob.leerInicio(`${carpeta}no-existe.png`, 12)).toBeNull();
  });

  it("verificarImagenSubida acepta PNG y WebP reales, rechaza un PDF con extensión .png y un archivo inexistente", async () => {
    expect(await verificarImagenSubida({ ruta: rutas.png, usuario })).toMatchObject({ tipo: "image/png", tamano: PNG.length });
    expect(await verificarImagenSubida({ ruta: rutas.webp, usuario })).toMatchObject({ tipo: "image/webp" });
    await expect(verificarImagenSubida({ ruta: rutas.falso, usuario })).rejects.toMatchObject({ status: 422 });
    await expect(verificarImagenSubida({ ruta: `${carpeta}no-existe.png`, usuario })).rejects.toMatchObject({ status: 404 });
    await expect(verificarImagenSubida({ ruta: rutas.png, usuario: otro })).rejects.toMatchObject({ status: 422 });
  });

  it("entregarImagen devuelve los bytes completos con el tipo real y las cabeceras de seguridad", async () => {
    const res = await entregarImagen({ ruta: rutas.png, usuario, autorizar: autorizarComprobantePorCarpeta });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("el administrador ve el comprobante y otro cliente recibe 404 sin leer Blob", async () => {
    expect((await entregarImagen({ ruta: rutas.png, usuario: admin, autorizar: autorizarComprobantePorCarpeta })).status).toBe(200);
    await expect(entregarImagen({ ruta: rutas.png, usuario: otro, autorizar: autorizarComprobantePorCarpeta })).rejects.toMatchObject({ status: 404 });
  });

  it("el archivo es privado: su URL directa no se sirve sin credenciales", async () => {
    const meta = await import("@vercel/blob").then((m) => m.head(rutas.png));
    const res = await fetch(meta.url);
    expect(res.ok).toBe(false);
  });

  it("listar devuelve la fecha de subida y el tamaño", async () => {
    const pagina = await almacenDeBlob.listar({ prefijo: carpeta });
    const png = pagina.elementos.find((e) => e.ruta === rutas.png);
    expect(png?.subidoEn).toBeInstanceOf(Date);
    expect(png?.tamano).toBe(PNG.length);
    expect(pagina.elementos.length).toBeGreaterThanOrEqual(3);
  });

  it("la limpieza no toca lo reciente y, 48 horas después, borra solo lo no referenciado", async () => {
    const ahora = new Date();
    const hoy = await limpiarHuerfanos({
      almacen: almacenAcotado,
      leerReferencias: async () => new Set<string>(),
      columnasDeclaradas: 1,
      ahora,
    });
    expect(hoy.borrados).toBe(0); // todo se subió hace segundos

    const enDosDias = await limpiarHuerfanos({
      almacen: almacenAcotado,
      leerReferencias: async () => new Set([rutas.png]),
      columnasDeclaradas: 1,
      ahora: new Date(ahora.getTime() + 48 * 3_600_000),
    });
    expect(enDosDias.borrados).toBe(2); // webp y el falso; el png está referenciado
    expect(await almacenDeBlob.metadatos(rutas.png)).not.toBeNull();
    expect(await almacenDeBlob.metadatos(rutas.webp)).toBeNull();
    expect(await almacenDeBlob.metadatos(rutas.falso)).toBeNull();
  });

  it("POST /api/subidas con el SDK real emite un token de cliente solo para la carpeta del usuario", async () => {
    const ruta = crearRutaSubidas({ sesion: async () => ({ id: usuario.id, correo: "x@tiza.test", nombre: "x", celular: "900000000", rol: "cliente" }) });
    const pedir = (pathname: string) =>
      ruta(
        new Request("http://localhost:3000/api/subidas", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "blob.generate-client-token", payload: { pathname, clientPayload: null, multipart: false } }),
        }),
      );
    const ok = await pedir(`${carpeta}nuevo.webp`);
    expect(ok.status).toBe(200);
    expect((await ok.json()).clientToken).toEqual(expect.any(String));
    expect((await pedir("comprobantes/prueba-imagenes-otro/nuevo.webp")).status).toBe(422);
  });
});
