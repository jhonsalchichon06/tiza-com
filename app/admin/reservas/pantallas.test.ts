import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ElementoDeApoyo } from "@/lib/admin/reservas/apoyo";
import type { ElementoDeReserva, RespuestaListado } from "@/lib/admin/reservas/listado";

const { usuarioActual, redirect } = vi.hoisted(() => ({
  usuarioActual: vi.fn(),
  redirect: vi.fn((destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  }),
}));
vi.mock("@/lib/sesion", () => ({ usuarioActual }));
vi.mock("next/navigation", () => ({ redirect, useRouter: () => ({ refresh: () => {} }) }));
// La portada (async desde el ítem 18) cuenta las reseñas por revisar; aquí sin base.
vi.mock("@/db/cliente", () => ({ db: () => ({}) }));
vi.mock("@/lib/resenas/moderar", () => ({ contarPendientes: async () => 2 }));

import LayoutAdmin from "../layout";
import Admin from "../page";
import { VistaApoyo } from "../apoyo/VistaApoyo";
import { VistaReprogramar } from "./ReprogramarReserva";
import { VistaReservas } from "./VistaReservas";

const ID = "11111111-1111-4111-8111-111111111111";
const PAGO = "22222222-2222-4222-8222-222222222222";
const EQUIPOS = [
  { id: 1, nombre: "Equipo 1" },
  { id: 2, nombre: "Equipo 2" },
];

const reserva = (extra: Partial<ElementoDeReserva> = {}): ElementoDeReserva => ({
  id: ID,
  estado: "confirmada",
  cliente: { id: "u1", nombre: "María Pérez", correo: "maria@tiza.test", celular: "987654321" },
  servicio: { tipo: "profunda", dormitorios: 3, banos: 2, horas_trabajo: 7 },
  direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: "Dpto. 302", referencias: null },
  inicio: "2026-11-06T10:00:00-05:00",
  fin: "2026-11-06T13:30:00-05:00",
  fin_bloqueo: "2026-11-06T14:30:00-05:00",
  horas_agenda: 3.5,
  expira_en: null,
  equipo: { id: 2, nombre: "Equipo 2" },
  requiere_apoyo: false,
  apoyo_estado: null,
  apoyo_nota: null,
  pago_id: PAGO,
  puede_completar: false,
  puede_reasignar: false,
  puede_reprogramar: false,
  reprogramada_en: null,
  reprogramada_por: null,
  ...extra,
});

const vista = (reservas: ElementoDeReserva[], filtro: string | null = null) => {
  const datos: RespuestaListado = { reservas, equipos: EQUIPOS };
  return renderToStaticMarkup(createElement(VistaReservas, { datos, filtro }));
};

describe("VistaReservas", () => {
  it("muestra cliente, servicio, dirección, fecha y hora de Lima, equipo y estado", () => {
    const html = vista([reserva()]);
    expect(html).toContain("María Pérez");
    expect(html).toContain("Limpieza profunda");
    expect(html).toContain("Av. Larco 123, Dpto. 302, Miraflores");
    expect(html).toContain("06/11/2026 10:00 a 13:30");
    expect(html).toContain("Equipo 2");
    expect(html).toContain("Confirmada");
    expect(html).toContain(`href="/admin/pagos/${PAGO}"`);
  });

  it("una pendiente vencida llega como expirada y se ve «Expirada», nunca «En espera»", () => {
    const html = vista([reserva({ estado: "expirada" })]);
    expect(html).toContain("Expirada");
    expect(html).not.toContain("En espera</span>");
  });

  it("el botón Completar solo aparece si puede_completar", () => {
    expect(vista([reserva({ puede_completar: true })])).toContain("Completar");
    expect(vista([reserva({ puede_completar: false })])).not.toContain("Completar");
  });

  it("el selector de equipos solo aparece si puede_reasignar, con los activos distintos del actual", () => {
    const con = vista([reserva({ puede_reasignar: true })]);
    expect(con).toContain("Reasignar");
    expect(con).toContain('Equipo 1</option>');
    expect(con).not.toContain('<option value="2">');
    expect(vista([reserva({ puede_reasignar: false })])).not.toContain("Reasignar");
  });

  it("indica el apoyo requerido y su estado", () => {
    expect(vista([reserva({ requiere_apoyo: true, apoyo_estado: "por_coordinar" })])).toContain("Requiere apoyo · por coordinar");
    expect(vista([reserva({ requiere_apoyo: true, apoyo_estado: "coordinado" })])).toContain("Requiere apoyo · coordinado");
    expect(vista([reserva()])).not.toContain("Requiere apoyo");
  });

  it("la lista vacía dice «No hay reservas para mostrar»", () => {
    expect(vista([])).toContain("No hay reservas para mostrar");
  });

  it("ofrece los filtros y marca el activo", () => {
    const html = vista([], "por_completar");
    expect(html).toContain('href="/admin/reservas?estado=por_completar"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/admin/reservas"');
  });
});

const apoyo = (extra: Partial<ElementoDeApoyo> = {}): ElementoDeApoyo => ({
  id: ID,
  estado: "confirmada",
  cliente: { id: "u1", nombre: "María Pérez", correo: "maria@tiza.test", celular: "987654321" },
  direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: null, referencias: null },
  inicio: "2026-11-09T08:00:00-05:00",
  fin: "2026-11-09T11:30:00-05:00",
  horas_trabajo: 7,
  horas_agenda: 3.5,
  apoyo_nota: null,
  dias_restantes: 4,
  pago_id: PAGO,
  puede_reprogramar: true,
  ...extra,
});

describe("VistaApoyo", () => {
  const html = (lista: ElementoDeApoyo[]) => renderToStaticMarkup(createElement(VistaApoyo, { apoyo: lista }));

  it("muestra los días que faltan, las horas de trabajo y de agenda, la dirección y el estado", () => {
    const marcado = html([apoyo()]);
    expect(marcado).toContain("faltan 4 días");
    expect(marcado).toContain("Trabajo de 7 horas · en la agenda 3,5 horas");
    expect(marcado).toContain("Av. Larco 123, Miraflores");
    expect(marcado).toContain("09/11/2026 08:00 a 11:30");
    expect(marcado).toContain("Confirmada");
    expect(marcado).toContain("Marcar coordinado");
  });

  it("conserva el orden del servidor (por fecha)", () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const marcado = html([apoyo({ id: a, dias_restantes: 2 }), apoyo({ id: b, dias_restantes: 6 })]);
    expect(marcado.indexOf("faltan 2 días")).toBeLessThan(marcado.indexOf("faltan 6 días"));
  });

  it("singular, hoy y atrasado", () => {
    expect(html([apoyo({ dias_restantes: 1 })])).toContain("faltan 1 día");
    expect(html([apoyo({ dias_restantes: 0 })])).toContain("es hoy");
    expect(html([apoyo({ dias_restantes: -2 })])).toContain("pasó hace 2 días");
  });

  it("una pendiente muestra su estado a la vista", () => {
    expect(html([apoyo({ estado: "pendiente" })])).toContain("En espera");
  });

  it("muestra la nota guardada y la precarga en el campo", () => {
    const marcado = html([apoyo({ apoyo_nota: "Rosa, 911222333" })]);
    expect(marcado).toContain("Nota: Rosa, 911222333");
    expect(marcado).toContain(">Rosa, 911222333</textarea>");
    expect(marcado).toContain('maxLength="500"');
  });

  it("la lista vacía dice «No hay apoyo por coordinar»", () => {
    expect(html([])).toContain("No hay apoyo por coordinar");
  });
});

describe("portada y layout del portal", () => {
  beforeEach(() => {
    usuarioActual.mockReset();
    redirect.mockClear();
  });

  it("enlaza a pagos (ítem 11), reservas y apoyo", async () => {
    const marcado = renderToStaticMarkup(await Admin());
    expect(marcado).toContain('href="/admin/pagos"');
    expect(marcado).toContain('href="/admin/reservas"');
    expect(marcado).toContain('href="/admin/apoyo"');
  });

  it("un cliente va a /cuenta y un visitante a /ingresar", async () => {
    usuarioActual.mockResolvedValue({ id: "u", rol: "cliente" });
    await expect(LayoutAdmin({ children: null })).rejects.toThrow("REDIRECT:/cuenta");
    usuarioActual.mockResolvedValue(null);
    await expect(LayoutAdmin({ children: null })).rejects.toThrow("REDIRECT:/ingresar?volver=/admin");
  });

  it("un administrador ve el contenido", async () => {
    usuarioActual.mockResolvedValue({ id: "a", rol: "admin" });
    await expect(LayoutAdmin({ children: "contenido" })).resolves.toBe("contenido");
  });
});

describe("reprogramar a nombre del cliente", () => {
  const vistaR = (props: Partial<Parameters<typeof VistaReprogramar>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(VistaReprogramar, {
        celular: "987654321",
        abierto: true,
        fecha: "2026-11-06",
        horarios: [
          { hora: "08:00", inicio: "2026-11-06T08:00:00-05:00", disponible: true },
          { hora: "08:30", inicio: "2026-11-06T08:30:00-05:00", disponible: false, motivo: "sin_cupo" },
        ],
        atendido: true,
        cargando: false,
        elegido: null,
        confirmando: false,
        enviando: false,
        mensaje: null,
        resultado: null,
        onAbrir: () => {},
        onCerrar: () => {},
        onFecha: () => {},
        onElegir: () => {},
        onPedirConfirmacion: () => {},
        onVolverDeConfirmar: () => {},
        onConfirmar: () => {},
        ...props,
      }),
    );

  it("el botón «Reprogramar» solo aparece en /admin/reservas si puede_reprogramar", () => {
    expect(vista([reserva({ puede_reprogramar: true })])).toContain("Reprogramar");
    expect(vista([reserva({ puede_reprogramar: false })])).not.toContain("Reprogramar");
  });

  it("en /admin/apoyo aparece junto a «Marcar coordinado» y solo si puede_reprogramar", () => {
    const con = renderToStaticMarkup(createElement(VistaApoyo, { apoyo: [apoyo()] }));
    expect(con).toContain("Marcar coordinado");
    expect(con).toContain("Reprogramar");
    const sin = renderToStaticMarkup(createElement(VistaApoyo, { apoyo: [apoyo({ puede_reprogramar: false })] }));
    expect(sin).toContain("Marcar coordinado");
    expect(sin).not.toContain("Reprogramar");
  });

  it("abierto: avisa que el sistema no avisa al cliente, muestra su celular y deja en gris el horario sin cupo", () => {
    const html = vistaR();
    expect(html).toContain("El sistema no avisa al cliente: acuerda antes el nuevo horario por WhatsApp.");
    expect(html).toContain("987654321");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>08:30<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>08:00<\/button>/);
  });

  it("pide confirmación previa con el nuevo horario antes de enviar", () => {
    const html = vistaR({ elegido: "2026-11-06T08:00:00-05:00", confirmando: true });
    expect(html).toContain("¿Ya acordaste este horario con el cliente por WhatsApp?");
    expect(html).toContain("06/11/2026 08:00");
    expect(html).toContain("Sí, reprogramar");
  });

  it("tras reprogramar muestra el nuevo horario y, si requiere apoyo, que volvió a la lista", () => {
    expect(vistaR({ resultado: { inicio: "2026-11-06T08:00:00-05:00", vuelveAApoyo: true } })).toContain("Volvió a la lista de apoyo por coordinar.");
    expect(vistaR({ resultado: { inicio: "2026-11-06T08:00:00-05:00", vuelveAApoyo: false } })).not.toContain("Volvió a la lista");
  });

  it("el listado dice quién y cuándo reprogramó", () => {
    const html = vista([reserva({ reprogramada_en: "2026-11-02T10:00:00-05:00", reprogramada_por: { id: "a1", nombre: "Admin Tiza" } })]);
    expect(html).toContain("Reprogramada por Admin Tiza el 02/11/2026 10:00");
  });
});
