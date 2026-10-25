import { describe, expect, it, vi } from "vitest";
import { ErrorImagen, MENSAJE_SUBIDA, MENSAJE_TAMANO, MENSAJE_TIPO, subirImagen, type EntornoDeImagen } from "../imagenes/cliente";
import { registrarFotosPorHttp } from "./api-cliente";
import { ErrorAlRegistrar, envioUnico, faltaAmbiente, recortarSeleccion, subirLote, type ItemDeFoto } from "./subir-lote";

const RESERVA = "11111111-1111-4111-8111-111111111111";
const MB = 1024 * 1024;
const archivo = (nombre: string, tipo: string, bytes = 1000) => new File([new Uint8Array(bytes)], nombre, { type: tipo });
const item = (n: number, extra: Partial<ItemDeFoto> = {}): ItemDeFoto => ({ clave: `k${n}`, archivo: archivo(`${n}.jpg`, "image/jpeg"), ambiente: "cocina", ...extra });

type Subir = NonNullable<Parameters<typeof subirLote>[0]["subir"]>;
const subirOk: Subir = async (a) => `fotos/${RESERVA}/${a.name}`;

describe("subirLote", () => {
  it("tres subidas correctas: un solo registro con las tres rutas y sus ambientes, en el orden elegido", async () => {
    const registrar = vi.fn(async () => undefined);
    const r = await subirLote({
      archivos: [item(1, { ambiente: "cocina" }), item(2, { ambiente: "bano" }), item(3, { ambiente: "sala" })],
      reservaId: RESERVA,
      subir: subirOk,
      registrar,
    });
    expect(registrar).toHaveBeenCalledTimes(1);
    expect(registrar).toHaveBeenCalledWith([
      { ruta: `fotos/${RESERVA}/1.jpg`, ambiente: "cocina" },
      { ruta: `fotos/${RESERVA}/2.jpg`, ambiente: "bano" },
      { ruta: `fotos/${RESERVA}/3.jpg`, ambiente: "sala" },
    ]);
    expect(r).toEqual({ registradas: ["k1", "k2", "k3"], fallidas: [] });
  });

  it("sube al destino {tipo: foto, reservaId}", async () => {
    const subir = vi.fn(subirOk);
    await subirLote({ archivos: [item(1)], reservaId: RESERVA, subir, registrar: async () => undefined });
    expect(subir.mock.calls[0][1]).toEqual({ tipo: "foto", reservaId: RESERVA });
  });

  it("dos ok y una falla: registra las dos y devuelve la fallida con su motivo", async () => {
    const registrar = vi.fn(async () => undefined);
    const subir: Subir = async (a) => {
      if (a.name === "2.jpg") throw new ErrorImagen(MENSAJE_SUBIDA);
      return `fotos/${RESERVA}/${a.name}`;
    };
    const r = await subirLote({ archivos: [item(1), item(2), item(3)], reservaId: RESERVA, subir, registrar });
    expect(registrar).toHaveBeenCalledWith([
      { ruta: `fotos/${RESERVA}/1.jpg`, ambiente: "cocina" },
      { ruta: `fotos/${RESERVA}/3.jpg`, ambiente: "cocina" },
    ]);
    expect(r.registradas).toEqual(["k1", "k3"]);
    expect(r.fallidas).toEqual([{ clave: "k2", motivo: MENSAJE_SUBIDA }]);
  });

  it("un error que no es de imagen se muestra con el mensaje genérico de subida", async () => {
    const subir: Subir = async () => {
      throw new TypeError("fetch failed");
    };
    const r = await subirLote({ archivos: [item(1)], reservaId: RESERVA, subir, registrar: async () => undefined });
    expect(r.fallidas).toEqual([{ clave: "k1", motivo: MENSAJE_SUBIDA }]);
  });

  it("todas fallan: no llama a registrar", async () => {
    const registrar = vi.fn(async () => undefined);
    const subir: Subir = async () => {
      throw new ErrorImagen(MENSAJE_SUBIDA);
    };
    const r = await subirLote({ archivos: [item(1), item(2)], reservaId: RESERVA, subir, registrar });
    expect(registrar).not.toHaveBeenCalled();
    expect(r.registradas).toEqual([]);
    expect(r.fallidas.map((f) => f.clave)).toEqual(["k1", "k2"]);
  });

  describe("archivos inválidos (con la validación real de #8)", () => {
    const entorno: EntornoDeImagen = {
      decodificar: async () => ({ ancho: 100, alto: 100, origen: null }),
      codificar: async () => new Blob([new Uint8Array(500)], { type: "image/webp" }),
    };
    const subidor = vi.fn(async (ruta: string) => ({ pathname: ruta }));
    const conSubirImagen: Subir = (a, destino) => subirImagen(a, { destino }, { entorno, subir: subidor });

    it("un PDF falla con el mensaje de #8 y no se sube", async () => {
      subidor.mockClear();
      const registrar = vi.fn(async () => undefined);
      const r = await subirLote({ archivos: [{ clave: "pdf", archivo: archivo("a.pdf", "application/pdf"), ambiente: "otro" }], reservaId: RESERVA, subir: conSubirImagen, registrar });
      expect(r.fallidas).toEqual([{ clave: "pdf", motivo: MENSAJE_TIPO }]);
      expect(subidor).not.toHaveBeenCalled();
      expect(registrar).not.toHaveBeenCalled();
    });

    it("una imagen de 6 MB falla con el mensaje de tamaño y no se sube; la válida sí", async () => {
      subidor.mockClear();
      const registrar = vi.fn(async () => undefined);
      const r = await subirLote({
        archivos: [
          { clave: "grande", archivo: archivo("g.jpg", "image/jpeg", 6 * MB), ambiente: "sala" },
          { clave: "bien", archivo: archivo("b.jpg", "image/jpeg", 1000), ambiente: "sala" },
        ],
        reservaId: RESERVA,
        subir: conSubirImagen,
        registrar,
      });
      expect(r.fallidas).toEqual([{ clave: "grande", motivo: MENSAJE_TAMANO }]);
      expect(r.registradas).toEqual(["bien"]);
      expect(subidor).toHaveBeenCalledTimes(1);
    });
  });

  it("si el registro responde 409, el error se propaga con las rutas que ya subieron para reintentar", async () => {
    const registrar = vi.fn(async () => {
      throw new Error("Esta reserva tiene 11 de 12 fotos: solo caben 1 más. No se registró ninguna.");
    });
    const e = await subirLote({ archivos: [item(1), item(2)], reservaId: RESERVA, subir: subirOk, registrar }).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorAlRegistrar);
    expect(e.message).toMatch(/solo caben 1 más/);
    expect(e.subidas).toEqual([
      { clave: "k1", ruta: `fotos/${RESERVA}/1.jpg` },
      { clave: "k2", ruta: `fotos/${RESERVA}/2.jpg` },
    ]);
  });

  it("reintentar con las rutas ya subidas no vuelve a subir, y reintentar solo las fallidas no repite las registradas", async () => {
    const subir = vi.fn(subirOk);
    const registrar = vi.fn(async () => undefined);
    // Reintento del registro: k1 ya tiene ruta (no se sube), k2 sí se sube.
    await subirLote({ archivos: [item(1, { ruta: `fotos/${RESERVA}/1.jpg` }), item(2)], reservaId: RESERVA, subir, registrar });
    expect(subir).toHaveBeenCalledTimes(1);
    expect(subir.mock.calls[0][0].name).toBe("2.jpg");
    expect(registrar).toHaveBeenCalledWith([
      { ruta: `fotos/${RESERVA}/1.jpg`, ambiente: "cocina" },
      { ruta: `fotos/${RESERVA}/2.jpg`, ambiente: "cocina" },
    ]);

    // Reintento solo de la fallida: las registradas ya no están en la selección, así que no se envían otra vez.
    subir.mockClear();
    registrar.mockClear();
    const r = await subirLote({ archivos: [item(3)], reservaId: RESERVA, subir, registrar });
    expect(subir).toHaveBeenCalledTimes(1);
    expect(registrar).toHaveBeenCalledWith([{ ruta: `fotos/${RESERVA}/3.jpg`, ambiente: "cocina" }]);
    expect(r.registradas).toEqual(["k3"]);
  });

  it("sube con concurrencia pequeña: nunca más de 2 a la vez", async () => {
    let activas = 0;
    let maximo = 0;
    const subir: Subir = async (a) => {
      activas++;
      maximo = Math.max(maximo, activas);
      await new Promise((r) => setTimeout(r, 5));
      activas--;
      return `fotos/${RESERVA}/${a.name}`;
    };
    await subirLote({ archivos: [1, 2, 3, 4, 5].map((n) => item(n)), reservaId: RESERVA, subir, registrar: async () => undefined });
    expect(maximo).toBe(2);
  });

  it("informa el progreso por archivo", async () => {
    const progreso: [string, number][] = [];
    const subir: Subir = async (a, _d, p) => {
      p(50);
      return `fotos/${RESERVA}/${a.name}`;
    };
    await subirLote({ archivos: [item(1)], reservaId: RESERVA, subir, registrar: async () => undefined, onProgreso: (c, p) => progreso.push([c, p]) });
    expect(progreso).toEqual([["k1", 50]]);
  });
});

describe("lógica del formulario", () => {
  it("falta el ambiente: se detecta y el formulario no sube", () => {
    expect(faltaAmbiente([{ ambiente: "cocina" }, { ambiente: "" }])).toBe(true);
    expect(faltaAmbiente([{ ambiente: "cocina" }, { ambiente: "sala" }])).toBe(false);
  });

  it("doble clic: solo se envía un registro", async () => {
    const registrar = vi.fn(() => new Promise<void>((r) => setTimeout(r, 10)));
    const enviar = envioUnico(() => subirLote({ archivos: [item(1)], reservaId: RESERVA, subir: subirOk, registrar }));
    await Promise.all([enviar(), enviar()]);
    expect(registrar).toHaveBeenCalledTimes(1);
    await enviar();
    expect(registrar).toHaveBeenCalledTimes(2);
  });

  it("el cerrojo del doble clic se libera aunque el envío falle", async () => {
    const enviar = envioUnico(async () => {
      throw new Error("x");
    });
    await expect(enviar()).rejects.toThrow("x");
    await expect(enviar()).rejects.toThrow("x");
  });

  it("faltan 2 y se eligen 4: se aceptan 2 y se avisa de las que sobran", () => {
    expect(recortarSeleccion([1, 2, 3, 4], 2)).toEqual({ aceptados: [1, 2], sobran: 2 });
    expect(recortarSeleccion([1], 5)).toEqual({ aceptados: [1], sobran: 0 });
    expect(recortarSeleccion([1, 2], 0)).toEqual({ aceptados: [], sobran: 2 });
  });
});

describe("registrarFotosPorHttp", () => {
  const respuesta = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo });

  it("envía un POST JSON con las fotos a la ruta de la reserva", async () => {
    const pedir = vi.fn(async () => respuesta(201, [{ id: "f1", ambiente: "cocina" }]));
    const r = await registrarFotosPorHttp(RESERVA, [{ ruta: "fotos/x/1.webp", ambiente: "cocina" }], pedir);
    expect(r).toEqual([{ id: "f1", ambiente: "cocina" }]);
    const [url, init] = pedir.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe(`/api/admin/reservas/${RESERVA}/fotos`);
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ fotos: [{ ruta: "fotos/x/1.webp", ambiente: "cocina" }] });
  });

  it("muestra el mensaje del servidor cuando responde con error", async () => {
    const pedir = async () => respuesta(409, { error: { codigo: "conflicto", mensaje: "Esta reserva ya llegó al máximo de 12 fotos." } });
    await expect(registrarFotosPorHttp(RESERVA, [], pedir)).rejects.toThrow("Esta reserva ya llegó al máximo de 12 fotos.");
  });

  it("si no hay conexión o la respuesta no es JSON, da un mensaje genérico en español", async () => {
    await expect(registrarFotosPorHttp(RESERVA, [], async () => { throw new TypeError("fetch failed"); })).rejects.toThrow(/No pudimos registrar las fotos/);
    await expect(registrarFotosPorHttp(RESERVA, [], async () => ({ ok: false, status: 500, json: async () => { throw new Error("no json"); } }))).rejects.toThrow(/No pudimos registrar las fotos/);
  });
});
