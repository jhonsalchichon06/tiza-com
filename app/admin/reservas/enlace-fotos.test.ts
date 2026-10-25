import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ElementoDeReserva, RespuestaListado } from "@/lib/admin/reservas/listado";

const { usuarioActual, redirect } = vi.hoisted(() => ({
  usuarioActual: vi.fn(),
  redirect: vi.fn((destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  }),
}));
vi.mock("@/lib/sesion", () => ({ usuarioActual }));
vi.mock("next/navigation", () => ({ redirect, useRouter: () => ({ refresh: () => {} }) }));

import LayoutAdmin from "../layout";
import { VistaReservas } from "./VistaReservas";

const ID = "11111111-1111-4111-8111-111111111111";
const reserva = (estado: ElementoDeReserva["estado"]): ElementoDeReserva => ({
  id: ID,
  estado,
  cliente: { id: "u1", nombre: "María Pérez", correo: "maria@tiza.test", celular: "987654321" },
  servicio: { tipo: "estandar", dormitorios: 2, banos: 1, horas_trabajo: 4 },
  direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: null, referencias: null },
  inicio: "2026-11-06T10:00:00-05:00",
  fin: "2026-11-06T14:00:00-05:00",
  fin_bloqueo: "2026-11-06T15:00:00-05:00",
  horas_agenda: 4,
  expira_en: null,
  equipo: { id: 1, nombre: "Equipo 1" },
  requiere_apoyo: false,
  apoyo_estado: null,
  apoyo_nota: null,
  pago_id: "22222222-2222-4222-8222-222222222222",
  puede_completar: false,
  puede_reasignar: false,
  puede_reprogramar: false,
  reprogramada_en: null,
  reprogramada_por: null,
});
const lista = (estado: ElementoDeReserva["estado"]) =>
  renderToStaticMarkup(createElement(VistaReservas, { datos: { reservas: [reserva(estado)], equipos: [] } as RespuestaListado, filtro: null }));

describe("enlace «Fotos» en la lista de reservas", () => {
  it("una reserva completada tiene el enlace a su pantalla de fotos", () => {
    const html = lista("completada");
    expect(html).toContain(`href="/admin/reservas/${ID}/fotos"`);
    expect(html).toContain(">Fotos<");
  });

  it.each(["confirmada", "pendiente", "cancelada", "expirada"] as const)("una reserva %s no lo tiene", (estado) => {
    const html = lista(estado);
    expect(html).not.toContain("/fotos");
    expect(html).not.toContain(">Fotos<");
  });
});

describe("layout de /admin para la pantalla de fotos", () => {
  beforeEach(() => {
    redirect.mockClear();
  });

  it("un cliente es redirigido a /cuenta y un visitante a /ingresar", async () => {
    usuarioActual.mockResolvedValueOnce({ id: "u1", rol: "cliente" });
    await expect(LayoutAdmin({ children: null })).rejects.toThrow("REDIRECT:/cuenta");
    usuarioActual.mockResolvedValueOnce(null);
    await expect(LayoutAdmin({ children: null })).rejects.toThrow("REDIRECT:/ingresar?volver=/admin");
  });

  it("un administrador ve el contenido", async () => {
    usuarioActual.mockResolvedValueOnce({ id: "a1", rol: "admin" });
    await expect(LayoutAdmin({ children: "fotos" })).resolves.toBe("fotos");
  });
});
