import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DetalleReserva } from "@/lib/perfil/detalle";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { PerfilVista } from "../../PerfilVista";
import { DetalleVista } from "./DetalleVista";
import { ResenaDelServicio } from "./ResenaDelServicio";

const base: DetalleReserva = {
  id: "r1",
  estado: "completada",
  estado_texto: "Completada",
  servicio: { tipo: "estandar", dormitorios: 2, banos: 1 },
  direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: null, referencias: null },
  inicio: "2026-11-05T10:00:00-05:00",
  fin: "2026-11-05T14:00:00-05:00",
  monto: 11610,
  precio_lista: 12900,
  horas_gratis_aplicadas: 0,
  requiere_apoyo: false,
  expira_en: null,
  enlace: "/cuenta/reservas/r1",
  puede_reprogramar: false,
  puede_cancelar: false,
  pago: null,
  resena: null,
  puede_resenar: true,
  fotos: [],
};
const vista = (extra: Partial<DetalleReserva> = {}) =>
  renderToStaticMarkup(createElement(DetalleVista, { detalle: { ...base, ...extra }, zona: "America/Lima", whatsapp: null, sinCambios: false }));
const componente = (props: Parameters<typeof ResenaDelServicio>[0]) => renderToStaticMarkup(createElement(ResenaDelServicio, props));

describe("reseña en el detalle de la reserva", () => {
  it("completada sin reseña: formulario con cinco botones de opción etiquetados, contador y botón", () => {
    const html = vista();
    expect(html).toContain("Tu reseña");
    expect(html.match(/type="radio"/g)).toHaveLength(5);
    for (const etiqueta of ["1 estrella<", "2 estrellas", "3 estrellas", "4 estrellas", "5 estrellas"]) expect(html).toContain(etiqueta);
    expect(html).toContain("0 de 500");
    expect(html).toContain("Enviar reseña");
    expect(html).toContain("<textarea");
  });

  it("pendiente: muestra su texto y su estado, con el formulario cargado para editar", () => {
    const html = vista({ resena: { estrellas: 4, comentario: "Todo muy bien, gracias.", estado: "pendiente" }, puede_resenar: false });
    expect(html).toContain("En revisión: aún no se muestra en la web");
    expect(html).toContain("Todo muy bien, gracias.");
    expect(html).toContain('aria-label="4 de 5 estrellas"');
    expect(html).toContain("<textarea");
  });

  it("aprobada: se ve como publicada y SIN formulario", () => {
    const html = vista({ resena: { estrellas: 5, comentario: "Excelente atención.", estado: "aprobada" }, puede_resenar: false });
    expect(html).toContain("Publicada en la web");
    expect(html).toContain("Excelente atención.");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<textarea");
  });

  it("rechazada: el mensaje y el formulario cargado con sus datos", () => {
    const html = vista({ resena: { estrellas: 2, comentario: "Llegaron tarde y no avisaron.", estado: "rechazada" }, puede_resenar: false });
    expect(html).toContain("No se publicó. Puedes editarla y enviarla de nuevo");
    expect(html).toContain("Llegaron tarde y no avisaron.");
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="2"/);
    expect(html).toContain("29 de 500");
    expect(html).toContain("Guardar y enviar de nuevo");
  });

  it("una reserva no completada no muestra la sección", () => {
    const html = vista({ estado: "confirmada", estado_texto: "Confirmada", puede_resenar: false, resena: null });
    expect(html).not.toContain("Tu reseña");
    expect(html).not.toContain('type="radio"');
  });

  it("el comentario del cliente sale escapado", () => {
    const html = componente({ reservaId: "r1", puedeResenar: false, resena: { estrellas: 3, comentario: "<img src=x onerror=alert(1)>", estado: "aprobada" } });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("«Deja tu reseña» en el historial", () => {
  const hist = (id: string, estado: string, resena_estado: "pendiente" | "aprobada" | "rechazada" | null) => ({
    id,
    estado,
    estado_texto: estado,
    servicio: { tipo: "estandar" as const, dormitorios: 2, banos: 1 },
    direccion: base.direccion,
    inicio: base.inicio,
    fin: base.fin,
    monto: 0,
    precio_lista: 12900,
    horas_gratis_aplicadas: 0,
    requiere_apoyo: false,
    expira_en: null,
    enlace: `/cuenta/reservas/${id}`,
    resena_estado,
  });
  const perfil = (historial: ReturnType<typeof hist>[]) =>
    renderToStaticMarkup(
      createElement(PerfilVista, {
        usuario: { id: "u1", nombre: "Ana", correo: "ana@tiza.test", celular: "999111222" },
        zona: "America/Lima",
        perfil: { membresia: { estado: "sin_membresia", plazo_vencido: false }, renovacion: { estado: "no_aplica" }, avisos: [], proximas: [], historial: historial as never, credito: { saldo_horas: 0, proximo_vencimiento: null, membresia_vencida: false } },
      }),
    );

  it("solo en las completadas sin reseña, con enlace al detalle", () => {
    const html = perfil([hist("a", "completada", null), hist("b", "completada", "pendiente"), hist("c", "completada", "rechazada"), hist("d", "cancelada", null)]);
    expect(html.match(/Deja tu reseña/g)).toHaveLength(1);
    expect(html).toMatch(/href="\/cuenta\/reservas\/a"[^>]*>Deja tu reseña/);
  });
});
