import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ResenaPendiente } from "@/lib/resenas/moderar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { VistaAdmin } from "../VistaAdmin";
import { AccionesResena } from "./AccionesResena";
import { VistaResenas } from "./VistaResenas";

const resena = (extra: Partial<ResenaPendiente> = {}): ResenaPendiente => ({
  revision: "huella",
  id: "44444444-4444-4444-8444-444444444444",
  estrellas: 4,
  comentario: "Muy buen servicio, volveré a reservar.",
  cliente: "María Pérez Rojas",
  distrito: "Miraflores",
  inicio: "2026-11-06T10:00:00-05:00",
  creada_en: "2026-11-07T09:30:00-05:00",
  ...extra,
});
const vista = (resenas: ResenaPendiente[]) => renderToStaticMarkup(createElement(VistaResenas, { resenas }));

describe("/admin/resenas", () => {
  it("lista tres pendientes con el cliente, el distrito, las estrellas y los botones", () => {
    const html = vista([resena({ id: "11111111-1111-4111-8111-111111111111" }), resena({ id: "22222222-2222-4222-8222-222222222222", cliente: "Luis Ríos" }), resena({ id: "33333333-3333-4333-8333-333333333333", estrellas: 5 })]);
    expect(html.match(/<li /g)).toHaveLength(3);
    expect(html).toContain("María Pérez Rojas");
    expect(html).toContain("Luis Ríos");
    expect(html).toContain("Miraflores");
    expect(html).toContain('aria-label="4 de 5 estrellas"');
    expect(html).toContain('aria-label="5 de 5 estrellas"');
    expect(html).toContain("06/11/2026 10:00");
    expect(html.match(/>Aprobar</g)).toHaveLength(3);
    expect(html.match(/>Rechazar</g)).toHaveLength(3);
  });

  it("advierte que el comentario se publicará tal cual", () => {
    expect(vista([resena()])).toContain("Revisa que el comentario no tenga datos personales: se publicará tal cual");
  });

  it("sin pendientes dice «No hay reseñas por revisar»", () => {
    const html = vista([]);
    expect(html).toContain("No hay reseñas por revisar");
    expect(html).not.toContain("<li ");
  });

  it("un comentario con <script> sale escapado como texto", () => {
    const html = vista([resena({ comentario: "<script>alert(1)</script>", cliente: "<b>X</b>" })]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<b>X</b>");
  });

  it("Rechazar empieza sin la confirmación (es de dos pasos)", () => {
    const html = renderToStaticMarkup(createElement(AccionesResena, { id: "x", revision: "h" }));
    expect(html).not.toContain("¿Rechazar esta reseña?");
  });
});

describe("portada del portal", () => {
  it("enlaza a las reseñas con el contador", () => {
    const html = renderToStaticMarkup(createElement(VistaAdmin, { pendientesResenas: 3 }));
    expect(html).toContain('href="/admin/resenas"');
    expect(html).toContain("Reseñas por revisar (3)");
  });

  it("si no se pudo contar, el enlace sale sin número", () => {
    const html = renderToStaticMarkup(createElement(VistaAdmin, { pendientesResenas: null }));
    expect(html).toContain("Reseñas por revisar<");
    expect(html).not.toContain("(");
  });
});
