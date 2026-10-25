import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

import type { DatosPantallaFotos } from "@/lib/fotos/pantalla";
import { leerPantallaFotos } from "@/lib/fotos/pantalla";
import { SubirFotos, TEXTO_FALTA_AMBIENTE, TEXTO_REVISAR_VISTA_PREVIA, VistaSubirFotos, textoRecortado } from "./SubirFotos";
import { TEXTO_LIMITE_ALCANZADO, TEXTO_NO_COMPLETADA, TEXTO_SIN_FOTOS, VistaFotos } from "./VistaFotos";

const ID = "11111111-1111-4111-8111-111111111111";
const datos = (extra: Partial<DatosPantallaFotos["reserva"]> = {}, fotos: DatosPantallaFotos["fotos"] = [], limite = 12): DatosPantallaFotos => ({
  reserva: {
    id: ID,
    estado: "completada",
    cliente: "María Pérez",
    servicio: { tipo: "profunda", dormitorios: 3, banos: 2, horas_trabajo: 7 },
    direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: "302" },
    inicio: "2026-11-06T10:00:00-05:00",
    ...extra,
  },
  limite,
  fotos,
});
const foto = (id: string, ambiente: string, etiqueta: string) => ({ id, ambiente, etiqueta });
const render = (d: DatosPantallaFotos) => renderToStaticMarkup(createElement(VistaFotos, { datos: d }));

describe("pantalla de fotos del administrador", () => {
  it("reserva completada sin fotos: muestra el formulario y «Aún no hay fotos»", () => {
    const html = render(datos());
    expect(html).toContain(TEXTO_SIN_FOTOS);
    expect(html).toContain('type="file"');
    expect(html).toContain("Subir fotos");
    expect(html).toContain("María Pérez");
    expect(html).toContain("06/11/2026 10:00");
    expect(html).toContain("Av. Larco 123");
    expect(html).not.toContain(TEXTO_NO_COMPLETADA);
  });

  it("con fotos: las agrupa por ambiente con el src de /api/fotos/<id>, perezosas y con el ambiente como texto alternativo", () => {
    const html = render(datos({}, [foto("a1", "sala", "Sala"), foto("a2", "cocina", "Cocina"), foto("a3", "sala", "Sala")]));
    expect(html).toContain('src="/api/fotos/a1"');
    expect(html).toContain('src="/api/fotos/a2"');
    expect(html).toContain('src="/api/fotos/a3"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('alt="Cocina"');
    expect(html.indexOf("Cocina")).toBeLessThan(html.indexOf(">Sala<"));
    expect(html).not.toContain(TEXTO_SIN_FOTOS);
    expect(html).toContain("(3 de 12)");
  });

  it("nunca incluye la ruta ni una URL de Blob", () => {
    const html = render(datos({}, [{ id: "a1", ambiente: "cocina", etiqueta: "Cocina", ruta: "fotos/x/1.webp" } as never]));
    expect(html).not.toContain("fotos/x");
    expect(html).not.toMatch(/blob\.vercel|vercel-storage/);
  });

  it.each(["confirmada", "pendiente", "cancelada", "expirada"] as const)("reserva %s: el mensaje y ningún formulario", (estado) => {
    const html = render(datos({ estado }));
    expect(html).toContain(TEXTO_NO_COMPLETADA);
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("Subir fotos");
  });

  it("cupo agotado: dice que llegó al máximo y no muestra el formulario", () => {
    const doce = Array.from({ length: 12 }, (_, i) => foto(`f${i}`, "cocina", "Cocina"));
    const html = render(datos({}, doce));
    expect(html).toContain(TEXTO_LIMITE_ALCANZADO(12));
    expect(html).not.toContain('type="file"');
  });

  it("dice cuántas fotos más caben", () => {
    const diez = Array.from({ length: 10 }, (_, i) => foto(`f${i}`, "cocina", "Cocina"));
    expect(render(datos({}, diez))).toContain("Puedes subir 2 fotos más");
    const once = Array.from({ length: 11 }, (_, i) => foto(`f${i}`, "cocina", "Cocina"));
    expect(render(datos({}, once))).toContain("Puedes subir 1 foto más");
  });

  it("el límite viene de los datos: con 5 y 2 fotos caben 3", () => {
    expect(render(datos({}, [foto("a", "sala", "Sala"), foto("b", "sala", "Sala")], 5))).toContain("Puedes subir 3 fotos más");
  });

  it("incluye el enlace para volver a la lista de reservas", () => {
    expect(render(datos())).toContain('href="/admin/reservas"');
  });
});

const elegida = (clave: string, ambiente = "") => ({ clave, ambiente, archivo: new File([new Uint8Array(10)], `${clave}.jpg`, { type: "image/jpeg" }), previa: `blob:${clave}` });
const vacias: Record<string, unknown> = {
  caben: 5,
  elegidas: [],
  fallidas: {},
  progreso: {},
  enviando: false,
  mensaje: null,
  aviso: null,
  pedirAmbiente: false,
  onElegir: () => {},
  onAmbiente: () => {},
  onQuitar: () => {},
  onSubir: () => {},
  onReintentar: () => {},
};
const renderForm = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(VistaSubirFotos, { ...vacias, ...extra } as never));

describe("formulario de subida (presentación)", () => {
  it("el selector admite varias imágenes JPG, PNG o WebP y el botón está deshabilitado sin selección", () => {
    const html = renderForm();
    expect(html).toContain("multiple");
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Subir fotos<\/button>/);
  });

  it("cada foto elegida tiene su vista previa y un selector de ambiente obligatorio con los siete ambientes", () => {
    const html = renderForm({ elegidas: [elegida("a"), elegida("b", "cocina")] });
    expect(html).toContain('src="blob:a"');
    expect(html).toContain('src="blob:b"');
    expect((html.match(/<select/g) ?? []).length).toBe(2);
    expect(html).toContain("required");
    for (const etiqueta of ["Cocina", "Baño", "Dormitorio", "Sala", "Comedor", "Lavandería", "Otro"]) expect(html).toContain(`>${etiqueta}<`);
    expect(html).toContain("Elige el ambiente");
    expect(html).toContain(TEXTO_REVISAR_VISTA_PREVIA);
  });

  it("durante el envío el botón se deshabilita, dice «Subiendo…» y muestra el progreso", () => {
    const html = renderForm({ elegidas: [elegida("a", "sala")], enviando: true, progreso: { a: 40 } });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Subiendo…<\/button>/);
    expect(html).toContain("40 %");
  });

  it("una foto fallida muestra su motivo y «Reintentar»; las que no fallaron no", () => {
    const html = renderForm({ elegidas: [elegida("a", "sala"), elegida("b", "sala")], fallidas: { a: "No pudimos subir la imagen." } });
    expect(html).toContain("No pudimos subir la imagen.");
    expect((html.match(/Reintentar/g) ?? []).length).toBe(1);
  });

  it("muestra el mensaje del servidor, el aviso de recorte y la petición del ambiente", () => {
    const html = renderForm({ mensaje: "Esta reserva ya llegó al máximo de 12 fotos.", aviso: textoRecortado(2, 2), pedirAmbiente: true });
    expect(html).toContain("Esta reserva ya llegó al máximo de 12 fotos.");
    expect(html).toContain("Solo caben 2 fotos más en esta reserva. Dejamos fuera 2.");
    expect(html).toContain(TEXTO_FALTA_AMBIENTE);
  });

  it("el componente de cliente se renderiza vacío con el cupo recibido", () => {
    const html = renderToStaticMarkup(createElement(SubirFotos, { reservaId: ID, caben: 2 }));
    expect(html).toContain("Puedes subir 2 fotos más");
  });

  it("el texto de recorte usa el singular cuando cabe una", () => {
    expect(textoRecortado(3, 1)).toBe("Solo caben 1 foto más en esta reserva. Dejamos fuera 3.");
  });
});

describe("leerPantallaFotos", () => {
  const fila = {
    id: ID,
    estado: "completada",
    cliente: "Ana",
    tipo: "estandar",
    dormitorios: 2,
    banos: 1,
    horasTrabajo: "4.0",
    distrito: "Miraflores",
    calle: "Av. Larco",
    numero: "123",
    departamento: null,
    inicio: new Date("2026-11-06T15:00:00Z"),
  };
  const baseCon = (filaReserva: unknown, fotos: unknown[] = []) => {
    let consulta = 0;
    const c = {
      from: () => c,
      innerJoin: () => c,
      where: () => c,
      orderBy: () => Promise.resolve(fotos),
      limit: () => Promise.resolve(filaReserva ? [filaReserva] : []),
    };
    return { select: () => { consulta++; return c; }, consultas: () => consulta };
  };
  const config = async () => ({ limite: 12, zona: "America/Lima" });

  it("un id que no es uuid o una reserva inexistente da null sin leer la configuración", async () => {
    const leer = vi.fn(config);
    expect(await leerPantallaFotos("abc", { base: () => baseCon(fila) as never, leerLimiteYZona: leer })).toBeNull();
    expect(await leerPantallaFotos(ID, { base: () => baseCon(null) as never, leerLimiteYZona: leer })).toBeNull();
    expect(leer).not.toHaveBeenCalled();
  });

  it("una completada trae sus fotos, el límite y la fecha en hora de Lima", async () => {
    const base = baseCon(fila, [{ id: "f1", ambiente: "bano" }]);
    const r = await leerPantallaFotos(ID, { base: () => base as never, leerLimiteYZona: config });
    expect(r?.fotos).toEqual([{ id: "f1", ambiente: "bano", etiqueta: "Baño" }]);
    expect(r?.limite).toBe(12);
    expect(r?.reserva.inicio).toBe("2026-11-06T10:00:00-05:00");
    expect(r?.reserva.servicio.horas_trabajo).toBe(4);
  });

  it("una reserva que no está completada no consulta fotos", async () => {
    const base = baseCon({ ...fila, estado: "confirmada" }, [{ id: "f1", ambiente: "bano" }]);
    const r = await leerPantallaFotos(ID, { base: () => base as never, leerLimiteYZona: config });
    expect(r?.fotos).toEqual([]);
    expect(base.consultas()).toBe(1);
  });
});
