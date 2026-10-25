import { describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../errores";
import { registrarFotos, type DependenciasRegistrar } from "./registrar";

vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const RESERVA = "11111111-1111-4111-8111-111111111111";
const OTRA = "22222222-2222-4222-8222-222222222222";
const ADMIN = { id: "admin-1", rol: "admin" as const };

type Opciones = {
  estadoPrevio?: string | null;
  estadoEnBloqueo?: string | null;
  existentes?: number;
  limite?: number;
  verificar?: DependenciasRegistrar["verificar"];
  falloAlInsertar?: unknown;
};

// Doble de la base: lectura previa del estado, y una transacción con el bloqueo, el conteo y el insert.
function armar(o: Opciones = {}) {
  const eventos: string[] = [];
  const insertados: Record<string, unknown>[] = [];
  const estadoPrevio = o.estadoPrevio === undefined ? "completada" : o.estadoPrevio;
  const estadoEnBloqueo = o.estadoEnBloqueo === undefined ? "completada" : o.estadoEnBloqueo;

  const tx = {
    select: (columnas: Record<string, unknown>) => ({
      from: () => ({
        where: () => {
          const resultado = "total" in columnas ? [{ total: o.existentes ?? 0 }] : estadoEnBloqueo === null ? [] : [{ estado: estadoEnBloqueo }];
          return { for: () => { eventos.push("bloqueo"); return Promise.resolve(resultado); }, then: (a: (v: unknown) => unknown) => Promise.resolve(resultado).then(a) };
        },
      }),
    }),
    insert: () => ({
      values: (valores: Record<string, unknown>[]) => ({
        returning: async () => {
          eventos.push("insert");
          if (o.falloAlInsertar) throw o.falloAlInsertar;
          insertados.push(...valores);
          return valores.map((v, i) => ({ id: `f${i + 1}`, ambiente: v.ambiente }));
        },
      }),
    }),
  };
  const transaccion = vi.fn(async (fn: (t: never) => Promise<unknown>) => {
    eventos.push("transaccion");
    return fn(tx as never);
  });
  const verificar = vi.fn(
    o.verificar ??
      (async ({ ruta }: { ruta: unknown }) => {
        eventos.push(`verificar:${String(ruta)}`);
        return { ruta: String(ruta), tipo: "image/webp" as const, tamano: 1000 };
      }),
  );
  const base = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => { eventos.push("lectura-previa"); return estadoPrevio === null ? [] : [{ estado: estadoPrevio }]; } }) }) }),
  };
  const dependencias = {
    base: () => base,
    transaccion,
    baseDeEscritura: () => ({}),
    verificar,
    leerLimite: async () => o.limite ?? 12,
  } as unknown as DependenciasRegistrar;
  return { dependencias, eventos, insertados, transaccion, verificar };
}

const foto = (n: number, reserva = RESERVA, ambiente = "cocina") => ({ ruta: `fotos/${reserva}/${n}.webp`, ambiente });
const cuerpo = (...fotos: { ruta: string; ambiente: string }[]) => ({ fotos });
const fallo = async (p: Promise<unknown>) => (await p.then(() => null, (e) => e)) as ErrorApi;

describe("registrarFotos", () => {
  it("tres fotos válidas se registran con subida_por del administrador y la respuesta las lista", async () => {
    const { dependencias, insertados } = armar();
    const r = await registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1, RESERVA, "cocina"), foto(2, RESERVA, "bano"), foto(3, RESERVA, "sala")) }, dependencias);
    expect(r).toEqual([
      { id: "f1", ambiente: "cocina" },
      { id: "f2", ambiente: "bano" },
      { id: "f3", ambiente: "sala" },
    ]);
    expect(insertados).toHaveLength(3);
    expect(insertados.every((f) => f.subidaPor === "admin-1" && f.reservaId === RESERVA)).toBe(true);
  });

  it.each([
    ["confirmada", /confirmada/],
    ["pendiente", /en espera del pago/],
    ["cancelada", /cancelada/],
    ["expirada", /expirada/],
  ])("reserva %s: 409 con el estado, sin llamar a Blob ni abrir la transacción", async (estado, mensaje) => {
    const { dependencias, verificar, transaccion } = armar({ estadoPrevio: estado });
    const e = await fallo(registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1)) }, dependencias));
    expect(e.status).toBe(409);
    expect(e.message).toMatch(mensaje);
    expect(verificar).not.toHaveBeenCalled();
    expect(transaccion).not.toHaveBeenCalled();
  });

  it("reserva inexistente: 404 sin tocar Blob", async () => {
    const { dependencias, verificar, transaccion } = armar({ estadoPrevio: null });
    const e = await fallo(registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1)) }, dependencias));
    expect(e.status).toBe(404);
    expect(verificar).not.toHaveBeenCalled();
    expect(transaccion).not.toHaveBeenCalled();
  });

  it("un id que no es uuid: 404 sin leer nada", async () => {
    const { dependencias, eventos } = armar();
    const e = await fallo(registrarFotos({ usuario: ADMIN, reservaId: "abc", cuerpo: cuerpo(foto(1)) }, dependencias));
    expect(e.status).toBe(404);
    expect(eventos).toEqual([]);
  });

  it("un archivo inexistente: error de la verificación y ninguna inserción, aunque las otras sean válidas", async () => {
    const { dependencias, eventos } = armar({
      verificar: async ({ ruta }) => {
        if (String(ruta).endsWith("/2.webp")) throw ErrorApi.noEncontrado("No encontramos el archivo que subiste. Súbelo de nuevo.");
        return { ruta: String(ruta), tipo: "image/webp", tamano: 1 };
      },
    });
    const e = await fallo(registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1), foto(2), foto(3)) }, dependencias));
    expect(e.status).toBe(404);
    expect(e.message).toMatch(/No encontramos el archivo/);
    expect(eventos).not.toContain("insert");
    expect(eventos).not.toContain("transaccion");
  });

  it("un PDF con extensión .png: 422 de la verificación y ninguna inserción", async () => {
    const { dependencias, eventos } = armar({
      verificar: async ({ ruta }) => {
        if (String(ruta).endsWith("/1.webp")) throw ErrorApi.invalido("El archivo no es una imagen JPG, PNG o WebP.");
        return { ruta: String(ruta), tipo: "image/webp", tamano: 1 };
      },
    });
    const e = await fallo(registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1), foto(2)) }, dependencias));
    expect(e.status).toBe(422);
    expect(eventos).not.toContain("insert");
  });

  it("una ruta de comprobantes/ es 422 y no se inserta nada", async () => {
    const { dependencias, eventos } = armar();
    const e = await fallo(
      registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1), { ruta: "comprobantes/admin-1/x.webp", ambiente: "otro" }) }, dependencias),
    );
    expect(e.status).toBe(422);
    expect(eventos).not.toContain("insert");
  });

  it("la verificación corre antes de abrir la transacción", async () => {
    const { dependencias, eventos } = armar();
    await registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1), foto(2)) }, dependencias);
    const iTransaccion = eventos.indexOf("transaccion");
    expect(iTransaccion).toBeGreaterThan(-1);
    expect(eventos.filter((e) => e.startsWith("verificar:"))).toHaveLength(2);
    expect(eventos.findLastIndex((e) => e.startsWith("verificar:"))).toBeLessThan(iTransaccion);
    expect(eventos.indexOf("lectura-previa")).toBeLessThan(eventos.indexOf("verificar:fotos/" + RESERVA + "/1.webp"));
  });

  it("la reserva se bloquea con FOR UPDATE antes de contar e insertar", async () => {
    const { dependencias, eventos } = armar();
    await registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1)) }, dependencias);
    expect(eventos.indexOf("bloqueo")).toBeGreaterThan(eventos.indexOf("transaccion"));
    expect(eventos.indexOf("bloqueo")).toBeLessThan(eventos.indexOf("insert"));
  });

  describe("límite por reserva", () => {
    it("10 existentes + 2 nuevas con límite 12: se acepta", async () => {
      const { dependencias } = armar({ existentes: 10 });
      const r = await registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1), foto(2)) }, dependencias);
      expect(r).toHaveLength(2);
    });

    it("11 existentes + 2 nuevas: 409 que dice cuántas caben y no inserta", async () => {
      const { dependencias, eventos } = armar({ existentes: 11 });
      const e = await fallo(registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1), foto(2)) }, dependencias));
      expect(e.status).toBe(409);
      expect(e.message).toMatch(/solo caben 1 más/);
      expect(eventos).not.toContain("insert");
    });

    it("con 12 existentes dice que ya llegó al máximo", async () => {
      const { dependencias } = armar({ existentes: 12 });
      const e = await fallo(registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1)) }, dependencias));
      expect(e.status).toBe(409);
      expect(e.message).toMatch(/máximo de 12/);
    });

    it("el límite es un dato: con 5, seis nuevas se rechazan por el cuerpo (422) y 3 + 3 dan 409", async () => {
      const seis = await fallo(registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(...[1, 2, 3, 4, 5, 6].map((n) => foto(n))) }, armar({ limite: 5 }).dependencias));
      expect(seis.status).toBe(422);
      const tres = await fallo(registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1), foto(2), foto(3)) }, armar({ limite: 5, existentes: 3 }).dependencias));
      expect(tres.status).toBe(409);
      const ok = await registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1), foto(2)) }, armar({ limite: 5, existentes: 3 }).dependencias);
      expect(ok).toHaveLength(2);
    });
  });

  it("si el estado cambia entre la lectura previa y el bloqueo: 409 sin insertar", async () => {
    const { dependencias, eventos } = armar({ estadoPrevio: "completada", estadoEnBloqueo: "cancelada" });
    const e = await fallo(registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1)) }, dependencias));
    expect(e.status).toBe(409);
    expect(e.message).toMatch(/cancelada/);
    expect(eventos).not.toContain("insert");
  });

  it("23505 directo: 409 «Esas fotos ya estaban registradas.»", async () => {
    const { dependencias } = armar({ falloAlInsertar: Object.assign(new Error("duplicada"), { code: "23505" }) });
    const e = await fallo(registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1)) }, dependencias));
    expect(e.status).toBe(409);
    expect(e.message).toBe("Esas fotos ya estaban registradas.");
  });

  it("23505 dentro de `cause` (como lo envuelve Drizzle): también 409", async () => {
    const { dependencias } = armar({ falloAlInsertar: Object.assign(new Error("Failed query"), { cause: { code: "23505" } }) });
    const e = await fallo(registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1)) }, dependencias));
    expect(e.status).toBe(409);
    expect(e.message).toBe("Esas fotos ya estaban registradas.");
  });

  it("otro error de la base no se traduce", async () => {
    const original = Object.assign(new Error("corte"), { code: "ECONNRESET" });
    const { dependencias } = armar({ falloAlInsertar: original });
    expect(await fallo(registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1)) }, dependencias))).toBe(original);
  });

  it("guarda la ruta que devolvió la verificación y no la enviada", async () => {
    const { dependencias, insertados } = armar({
      verificar: async ({ ruta }) => ({ ruta: String(ruta), tipo: "image/webp", tamano: 1 }),
    });
    const enviada = `fotos/${RESERVA}/1.webp`;
    // La verificación normaliza: devuelve la ruta de la carpeta + nombre. Aquí devuelve la misma, pero se prueba el origen.
    const verificar = vi.fn(async () => ({ ruta: `fotos/${RESERVA}/normalizada.webp`, tipo: "image/webp" as const, tamano: 1 }));
    await registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo({ ruta: enviada, ambiente: "sala" }) }, { ...dependencias, verificar } as DependenciasRegistrar);
    expect(insertados[0].ruta).toBe(`fotos/${RESERVA}/normalizada.webp`);
    expect(insertados[0].ruta).not.toBe(enviada);
  });

  it("rutas repetidas dentro del mismo envío: 422 sin llegar a Blob", async () => {
    const { dependencias, verificar } = armar();
    const e = await fallo(registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1), foto(1)) }, dependencias));
    expect(e.status).toBe(422);
    expect(verificar).not.toHaveBeenCalled();
  });

  it("cuerpo con ambiente fuera de la lista: 422", async () => {
    const { dependencias } = armar();
    const e = await fallo(registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1, RESERVA, "garaje")) }, dependencias));
    expect(e.status).toBe(422);
    expect(e.message).toMatch(/ambiente/);
  });

  describe("carpeta de la reserva", () => {
    it("una ruta de fotos/<otra reserva>/ enviada a la URL de A: 422 y nada se inserta", async () => {
      const { dependencias, eventos } = armar();
      const e = await fallo(registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1), foto(2, OTRA)) }, dependencias));
      expect(e.status).toBe(422);
      expect(e.message).toMatch(/no corresponde a esta reserva/);
      expect(eventos).not.toContain("transaccion");
    });

    it("una ruta de fotos/<A>/x.webp en la URL de A: se acepta", async () => {
      const { dependencias } = armar();
      const r = await registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo({ ruta: `fotos/${RESERVA}/x.webp`, ambiente: "otro" }) }, dependencias);
      expect(r).toHaveLength(1);
    });

    it("compara contra la ruta verificada, no contra la enviada", async () => {
      // Enviada con la carpeta de A, pero la verificación devuelve una de B: se rechaza.
      const { dependencias } = armar({ verificar: async () => ({ ruta: `fotos/${OTRA}/x.webp`, tipo: "image/webp", tamano: 1 }) });
      const e = await fallo(registrarFotos({ usuario: ADMIN, reservaId: RESERVA, cuerpo: cuerpo(foto(1)) }, dependencias));
      expect(e.status).toBe(422);
    });

    it("un id en mayúsculas en la URL se compara en minúsculas", async () => {
      const { dependencias } = armar();
      const r = await registrarFotos({ usuario: ADMIN, reservaId: RESERVA.toUpperCase(), cuerpo: cuerpo(foto(1)) }, dependencias);
      expect(r).toHaveLength(1);
    });
  });
});
