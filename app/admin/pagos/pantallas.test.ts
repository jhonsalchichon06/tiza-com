import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DetalleDePago, ElementoDePago } from "@/lib/pagos/listado";

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
vi.mock("@/lib/resenas/moderar", () => ({ contarPendientes: async () => 0 }));

import LayoutAdmin from "../layout";
import Admin from "../page";
import { VistaDetallePago } from "./[id]/VistaDetallePago";
import { VistaListaPagos } from "./VistaListaPagos";

const PAGO_ID = "11111111-1111-4111-8111-111111111111";
const RESERVA_ID = "33333333-3333-4333-8333-333333333333";

const elemento = (id: string, extra: Partial<ElementoDePago["pago"]> = {}, reserva: ElementoDePago["reserva"] = null): ElementoDePago => ({
  pago: {
    id,
    concepto: "membresia_y_reserva",
    monto: 33666,
    metodo: "yape",
    estado: "pendiente",
    creado_en: "2026-11-02T10:00:00-05:00",
    revisado_en: null,
    motivo_rechazo: null,
    reemplaza_a: null,
    reenvio_hasta: null,
    reenvio_vigente: null,
    ...extra,
  },
  cliente: { id: "u1", nombre: "María Pérez", correo: "maria@tiza.test", celular: "987654321" },
  membresia: { id: "m1", estado: "pendiente" },
  reserva,
  comprobante: `/api/comprobantes/${id}`,
});

const RESERVA: NonNullable<ElementoDePago["reserva"]> = {
  id: RESERVA_ID,
  estado: "pendiente",
  expira_en: "2026-11-03T10:00:00-05:00",
  inicio: "2026-11-07T10:00:00-05:00",
  tipo: "profunda",
  distrito: "Miraflores",
  calle: "Av. Larco",
  numero: "123",
  departamento: "Dpto. 302",
  monto: 6966,
  primera_gratis: true,
  horas_gratis_aplicadas: 3,
  credito_faltante_horas: 0,
};

const detalle = (extra: Partial<DetalleDePago> = {}, pago: Partial<ElementoDePago["pago"]> = {}, reserva = RESERVA): DetalleDePago => ({
  ...elemento(PAGO_ID, pago, reserva),
  coincidencias: { aplica: true, lista: [] },
  ...extra,
});

const html = (d: DetalleDePago) => renderToStaticMarkup(createElement(VistaDetallePago, { detalle: d }));

describe("VistaListaPagos", () => {
  it("lista vacía: «No hay pagos por revisar»", () => {
    const marcado = renderToStaticMarkup(createElement(VistaListaPagos, { pagos: [] }));
    expect(marcado).toContain("No hay pagos por revisar");
  });

  it("un pago de 33666 céntimos se muestra como S/ 336,66 y enlaza a su detalle", () => {
    const marcado = renderToStaticMarkup(createElement(VistaListaPagos, { pagos: [elemento(PAGO_ID, {}, RESERVA)] }));
    expect(marcado).toContain("S/ 336,66");
    expect(marcado).toContain(`href="/admin/pagos/${PAGO_ID}"`);
    expect(marcado).toContain("María Pérez");
    expect(marcado).toContain("Membresía y limpieza");
    expect(marcado).toContain("Vence 03/11/2026 10:00");
    expect(marcado).not.toContain("No hay pagos por revisar");
  });

  it("conserva el orden que dio el servidor", () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const marcado = renderToStaticMarkup(createElement(VistaListaPagos, { pagos: [elemento(b), elemento(a)] }));
    expect(marcado.indexOf(b)).toBeLessThan(marcado.indexOf(a));
  });

  it("un pago sin reserva lo dice", () => {
    const marcado = renderToStaticMarkup(createElement(VistaListaPagos, { pagos: [elemento(PAGO_ID)] }));
    expect(marcado).toContain("Sin reserva");
  });
});

describe("VistaDetallePago", () => {
  it("muestra cliente, concepto, monto en soles, método, vencimiento y la imagen del comprobante", () => {
    const marcado = html(detalle());
    expect(marcado).toContain("María Pérez");
    expect(marcado).toContain("maria@tiza.test");
    expect(marcado).toContain("Membresía y limpieza");
    expect(marcado).toContain("S/ 336,66");
    expect(marcado).toContain("Yape");
    expect(marcado).toContain("03/11/2026 10:00"); // vencimiento de la reserva
    expect(marcado).toContain(`src="/api/comprobantes/${PAGO_ID}"`);
    expect(marcado).toContain("Av. Larco 123, Dpto. 302, Miraflores");
    expect(marcado).toContain("3 horas gratis");
  });

  it("sin faltante de crédito no muestra esa fila; con faltante lo dice con las horas", () => {
    expect(html(detalle())).not.toContain("Crédito sin tomar");
    const h = html(detalle({}, {}, { ...RESERVA, estado: "confirmada", credito_faltante_horas: 1.5 }));
    expect(h).toContain("Crédito sin tomar");
    expect(h).toContain("1,5 horas");
  });

  it("sin coincidencias lo dice", () => {
    expect(html(detalle())).toContain("Sin coincidencias");
  });

  it("las coincidencias salen con su nivel", () => {
    const lista = [
      { nivel: "otro_departamento" as const, cliente: "Ana Ruiz", distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: "Dpto. 101", estado: "confirmada", inicio: "2026-10-20T09:00:00-05:00" },
      { nivel: "calle_parecida" as const, cliente: "Luis Gómez", distrito: "Miraflores", calle: "Larco", numero: "123", departamento: null, estado: "completada", inicio: "2026-09-10T09:00:00-05:00" },
    ];
    const marcado = html(detalle({ coincidencias: { aplica: true, lista } }));
    expect(marcado).toContain("Mismo edificio, otro departamento");
    expect(marcado).toContain("Calle parecida");
    expect(marcado).toContain("Ana Ruiz");
    expect(marcado).not.toContain("Sin coincidencias");
  });

  it("un pago sin limpieza gratis no busca coincidencias", () => {
    expect(html(detalle({ coincidencias: { aplica: false, lista: [] } }))).toContain("no incluye una limpieza gratis");
  });

  it("pendiente: Aprobar, Rechazar y Cancelar reserva", () => {
    const marcado = html(detalle());
    expect(marcado).toContain("Aprobar");
    expect(marcado).toContain("Rechazar");
    expect(marcado).toContain("Cancelar reserva");
  });

  it("pendiente pero con la reserva expirada: no se puede cancelar", () => {
    const marcado = html(detalle({}, {}, { ...RESERVA, estado: "expirada", expira_en: null }));
    expect(marcado).toContain("Aprobar");
    expect(marcado).not.toContain("Cancelar reserva");
  });

  it.each(["aprobado", "rechazado"])("pago %s: sin botones", (estado) => {
    const marcado = html(detalle({}, { estado }));
    expect(marcado).not.toContain("Aprobar");
    expect(marcado).not.toContain("Rechazar");
    expect(marcado).not.toContain("Cancelar reserva");
  });

  it("un pago rechazado muestra el motivo y hasta cuándo puede reenviar", () => {
    const marcado = html(detalle({}, { estado: "rechazado", motivo_rechazo: "Imagen borrosa", reenvio_hasta: "2026-11-09T10:00:00-05:00", reenvio_vigente: true }));
    expect(marcado).toContain("Imagen borrosa");
    expect(marcado).toContain("09/11/2026 10:00");
  });

  it("sin reserva lo explica", () => {
    const base = detalle();
    expect(html({ ...base, reserva: null })).toContain("no tiene una reserva asociada");
  });
});

describe("portada del portal", () => {
  it("enlaza a /admin/pagos", async () => {
    expect(renderToStaticMarkup(await Admin())).toContain('href="/admin/pagos"');
  });
});

describe("layout de /admin", () => {
  beforeEach(() => {
    usuarioActual.mockReset();
    redirect.mockClear();
  });

  it("un visitante sin sesión es enviado a ingresar", async () => {
    usuarioActual.mockResolvedValue(null);
    await expect(LayoutAdmin({ children: null })).rejects.toThrow("REDIRECT:/ingresar?volver=/admin");
  });

  it("un cliente es enviado a su cuenta", async () => {
    usuarioActual.mockResolvedValue({ id: "u1", rol: "cliente" });
    await expect(LayoutAdmin({ children: null })).rejects.toThrow("REDIRECT:/cuenta");
  });

  it("un administrador pasa", async () => {
    usuarioActual.mockResolvedValue({ id: "a1", rol: "admin" });
    await expect(LayoutAdmin({ children: "contenido" })).resolves.toBe("contenido");
    expect(redirect).not.toHaveBeenCalled();
  });
});
