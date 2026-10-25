import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorApi } from "@/lib/errores";
import { construirAvisos } from "@/lib/perfil/avisos";
import type { RespuestaNuevoHorario } from "@/lib/reservas/nuevo-horario";
import type { DatosNuevoHorario } from "@/lib/reservas/nuevo-horario-datos";
import { Avisos } from "../../Avisos";
import NuevoHorario from "./page";
import { TEXTO_YA_PAGASTE, VistaNuevoHorario } from "./VistaNuevoHorario";

const mocks = vi.hoisted(() => ({ usuario: vi.fn(), leer: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/sesion", () => ({ usuarioActual: mocks.usuario }));
vi.mock("@/lib/reservas/nuevo-horario-datos", () => ({ leerNuevoHorario: mocks.leer }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const PAGO = "11111111-1111-4111-8111-111111111111";
const nada = () => {};
const DATOS: DatosNuevoHorario = {
  pago: { id: PAGO, monto_pagado: 33666 },
  servicio: { tipo: "profunda", dormitorios: 2, banos: 1 },
  direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: "Dpto. 302", referencias: null },
  horas_trabajo: 5,
  horas_agenda: 5,
  horas_gratis_aplicadas: 3,
  requiere_apoyo: false,
  fechas: { desde: "2026-11-04", hasta: "2027-01-20" },
  limite: "2027-01-20T10:00:00-05:00",
  membresia_vigente: true,
};
const CREADA: RespuestaNuevoHorario = {
  reserva: {
    id: "r1",
    estado: "confirmada",
    servicio: { tipo: "profunda", dormitorios: 2, banos: 1 },
    inicio: "2026-11-07T10:00:00-05:00",
    fin: "2026-11-07T15:00:00-05:00",
    expira_en: null,
    monto: 6966,
    precio_lista: 19350,
    horas_gratis_aplicadas: 3,
    requiere_apoyo: false,
    apoyo_estado: null,
  },
  pago: { id: PAGO, concepto: "membresia_y_reserva", monto: 33666, metodo: "yape", estado: "aprobado" },
  credito_faltante_horas: 0,
  whatsapp: "https://wa.me/51999999999?text=Hola",
};

const vista = (extra: Partial<Parameters<typeof VistaNuevoHorario>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(VistaNuevoHorario, {
      datos: DATOS,
      dias: ["2026-11-04", "2026-11-05"],
      dia: null,
      horario: null,
      disponibilidad: { estado: "sin_elegir" },
      mensaje: null,
      enviando: false,
      resultado: null,
      onDia: nada,
      onHorario: nada,
      onReintentarHorarios: nada,
      onConfirmar: nada,
      ...extra,
    }),
  );

const boton = (html: string) => /<button[^>]*>(Confirmar mi nuevo horario|Enviando\.\.\.)<\/button>/.exec(html)?.[0] ?? "";

describe("VistaNuevoHorario", () => {
  it("muestra el servicio, la dirección y que no hay que pagar otra vez", () => {
    const h = vista();
    expect(h).toContain("Limpieza profunda");
    expect(h).toContain("Av. Larco 123, Dpto. 302, Miraflores");
    expect(h).toContain(TEXTO_YA_PAGASTE);
    expect(h).toContain("Ya pagaste esta limpieza: no tienes que pagar otra vez");
    expect(h).not.toContain('type="file"');
    expect(h).not.toContain("Yape");
  });

  it("ofrece los días del servidor y no pide método ni comprobante", () => {
    const h = vista();
    expect(h).toContain('aria-label="miércoles 4 de noviembre"');
    expect(h).toContain('aria-label="jueves 5 de noviembre"');
  });

  it("en gris los horarios que no caben, los de poca anticipación y los posteriores al fin de la membresía", () => {
    const h = vista({
      dia: "2026-11-04",
      disponibilidad: {
        estado: "listo",
        atendido: true,
        horarios: [
          { hora: "08:00", inicio: "2026-11-04T08:00:00-05:00", disponible: false, motivo: "anticipacion" },
          { hora: "09:00", inicio: "2026-11-04T09:00:00-05:00", disponible: false, motivo: "sin_cupo" },
          { hora: "10:00", inicio: "2026-11-04T10:00:00-05:00", disponible: true },
        ],
      },
      datos: { ...DATOS, limite: "2026-11-04T10:00:00-05:00" },
    });
    expect(/<button[^>]*aria-label="08:00[^"]*"[^>]*>/.exec(h)?.[0]).toContain("disabled");
    expect(/<button[^>]*aria-label="09:00[^"]*"[^>]*>/.exec(h)?.[0]).toContain("disabled");
    // 10:00 es igual al límite (el fin de la membresía): ya no se puede empezar.
    expect(h).toContain("fuera de la vigencia de tu membresía");
    expect(/<button[^>]*aria-label="10:00[^"]*"[^>]*>/.exec(h)?.[0]).toContain("disabled");
  });

  it("sin horario elegido el botón de confirmar está deshabilitado; con uno, habilitado", () => {
    expect(boton(vista())).toContain("disabled");
    expect(boton(vista({ horario: { hora: "10:00", inicio: "2026-11-04T10:00:00-05:00" } }))).not.toContain("disabled");
  });

  it("durante el envío el botón está deshabilitado y dice Enviando", () => {
    const h = boton(vista({ horario: { hora: "10:00", inicio: "2026-11-04T10:00:00-05:00" }, enviando: true }));
    expect(h).toContain("disabled");
    expect(h).toContain("Enviando...");
  });

  it("sin cupo al confirmar: vuelve a la lista con el mensaje y se puede elegir otra hora", () => {
    const h = vista({ mensaje: "Esa hora ya no está disponible. Elige otra hora.", dia: "2026-11-04" });
    expect(h).toContain("Esa hora ya no está disponible. Elige otra hora.");
    expect(boton(h)).toContain("disabled");
    expect(h).toContain('aria-label="miércoles 4 de noviembre"');
  });

  it("pago_en_credito: muestra el mensaje con el enlace a la cuenta y sin selector de horarios", () => {
    const h = vista({ enCredito: true, mensaje: "Las horas de esa cancelación pasan a tu crédito. Úsalo en tu próxima reserva." });
    expect(h).toContain("Las horas de esa cancelación pasan a tu crédito");
    expect(h).toContain('href="/cuenta"');
    expect(h).not.toContain("Confirmar mi nuevo horario");
    expect(h).not.toContain("Elige el día");
  });

  it("la reserva confirmada: sin subir comprobante y con el enlace de WhatsApp", () => {
    const h = vista({ resultado: CREADA });
    expect(h).toContain("¡Tu limpieza está confirmada!");
    expect(h).toContain("no tuviste que subir otro comprobante");
    expect(h).toContain("sábado 7 de noviembre, 10:00");
    expect(h).toContain('href="https://wa.me/51999999999?text=Hola"');
    expect(h).toContain('href="/cuenta"');
    expect(h).not.toContain("Confirmar mi nuevo horario");
  });

  it("una duración, un horario y un paquete se escriben con lo que dijo el servidor", () => {
    const h = vista({ datos: { ...DATOS, servicio: { tipo: "paquete", horas: 4 }, horas_trabajo: 4 } });
    expect(h).toContain("Paquete de 4 horas");
  });
});

describe("la página /cuenta/nuevo-horario/[pagoId]", () => {
  beforeEach(() => {
    mocks.usuario.mockReset();
    mocks.leer.mockReset();
  });
  const params = (id = PAGO) => ({ params: Promise.resolve({ pagoId: id }) });
  const pintar = (elemento: ReactElement) => renderToStaticMarkup(elemento);

  it("sin sesión redirige a /ingresar con la ruta de vuelta", async () => {
    mocks.usuario.mockResolvedValue(null);
    await expect(NuevoHorario(params())).rejects.toThrow(`REDIRECT:/ingresar?volver=/cuenta/nuevo-horario/${PAGO}`);
    expect(mocks.leer).not.toHaveBeenCalled();
  });

  it("un pago propio muestra la pantalla con los datos del servidor", async () => {
    mocks.usuario.mockResolvedValue({ id: "u1" });
    mocks.leer.mockResolvedValue(DATOS);
    const h = pintar(await NuevoHorario(params()));
    expect(h).toContain("Elige tu nuevo día y hora");
    expect(h).toContain("Av. Larco 123, Dpto. 302, Miraflores");
    expect(h).toContain(TEXTO_YA_PAGASTE);
    expect(mocks.leer).toHaveBeenCalledWith(expect.objectContaining({ usuario: { id: "u1" }, pagoId: PAGO }));
  });

  it("un pago ajeno, inexistente o con id mal formado da la página de no encontrada", async () => {
    mocks.usuario.mockResolvedValue({ id: "u1" });
    mocks.leer.mockRejectedValue(ErrorApi.noEncontrado("No encontramos ese pago."));
    await expect(NuevoHorario(params("abc"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("un pago cuyas horas pasan a crédito muestra su mensaje, con el enlace a la cuenta", async () => {
    mocks.usuario.mockResolvedValue({ id: "u1" });
    mocks.leer.mockRejectedValue(new ErrorApi(409, "pago_en_credito", "Las horas de esa cancelación pasan a tu crédito. Úsalo en tu próxima reserva."));
    const h = pintar(await NuevoHorario(params()));
    expect(h).toContain("Las horas de esa cancelación pasan a tu crédito");
    expect(h).toContain('href="/cuenta"');
    expect(h).not.toContain("Confirmar mi nuevo horario");
  });

  it("un pago que ya no admite horario muestra el mensaje del servidor", async () => {
    mocks.usuario.mockResolvedValue({ id: "u1" });
    mocks.leer.mockRejectedValue(ErrorApi.conflicto("Ese pago no tiene un horario pendiente por elegir."));
    expect(pintar(await NuevoHorario(params()))).toContain("Ese pago no tiene un horario pendiente por elegir.");
  });

  it("un error inesperado se propaga", async () => {
    mocks.usuario.mockResolvedValue({ id: "u1" });
    mocks.leer.mockRejectedValue(new Error("boom"));
    await expect(NuevoHorario(params())).rejects.toThrow("boom");
  });
});

describe("el aviso «Elige un nuevo día y hora» del perfil", () => {
  it("enlaza a la pantalla del nuevo horario de ese pago", () => {
    const avisos = construirAvisos({
      membresia: { estado: "activa", inicio: "2026-10-01T10:00:00-05:00", fin: "2027-01-01T10:00:00-05:00", dias_restantes: 60 },
      rechazados: [],
      pagosNuevoHorario: [{ id: PAGO }],
      gratisConservada: false,
      config: { horas_gratis: 3 },
      zona: "America/Lima",
      ahora: new Date("2026-11-02T15:00:00Z"),
    });
    const h = renderToStaticMarkup(createElement(Avisos, { avisos, usuarioId: "u1", zona: "America/Lima" }));
    expect(h).toContain("Elige un nuevo día y hora");
    expect(h).toContain(`href="/cuenta/nuevo-horario/${PAGO}"`);
    expect(h).toContain("Elegir mi nuevo día y hora");
  });
});

describe("el código de la pantalla no escribe cifras ni plazos", () => {
  it("ningún archivo de la pantalla escribe un precio, un porcentaje ni el plazo de la espera", () => {
    const base = join(process.cwd(), "app", "(cuenta)", "cuenta", "nuevo-horario", "[pagoId]");
    for (const archivo of ["VistaNuevoHorario.tsx", "ElegirNuevoHorario.tsx", "page.tsx"]) {
      const texto = readFileSync(join(base, archivo), "utf8");
      expect(texto, archivo).not.toMatch(/S\/ ?\d|\d+ ?%|\b24\b|\b267\b|\b89\b/);
    }
  });
});
