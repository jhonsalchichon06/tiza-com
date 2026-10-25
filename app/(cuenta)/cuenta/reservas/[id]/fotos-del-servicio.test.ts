import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DetalleReserva } from "@/lib/perfil/detalle";
import type { HistorialVista } from "@/lib/perfil/reservas";
import type { RespuestaPerfil } from "@/lib/perfil/resumen";
import { PerfilVista } from "../../PerfilVista";
import { DetalleVista } from "./DetalleVista";
import { FotosDelServicio, TEXTO_SIN_FOTOS_DEL_SERVICIO } from "./FotosDelServicio";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const foto = (id: string, ambiente: string, etiqueta: string) => ({ id, ambiente, etiqueta });
const CINCO = [foto("f1", "bano", "Baño"), foto("f2", "cocina", "Cocina"), foto("f3", "cocina", "Cocina"), foto("f4", "bano", "Baño"), foto("f5", "cocina", "Cocina")];
const render = (estado: string, fotos: ReturnType<typeof foto>[]) => renderToStaticMarkup(createElement(FotosDelServicio, { estado, fotos }));

describe("FotosDelServicio", () => {
  it("cinco fotos en dos ambientes: las agrupa bajo su ambiente, en el orden de la lista de ambientes", () => {
    const html = render("completada", CINCO);
    expect((html.match(/<img/g) ?? []).length).toBe(5);
    expect(html.indexOf(">Cocina<")).toBeLessThan(html.indexOf(">Baño<"));
    for (const id of ["f1", "f2", "f3", "f4", "f5"]) expect(html).toContain(`src="/api/fotos/${id}"`);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('alt="Cocina"');
    expect(html).toContain('alt="Baño"');
    expect(html).toContain('aria-label="Fotos del servicio"');
  });

  it("completada sin fotos: «Aún no hay fotos de este servicio»", () => {
    const html = render("completada", []);
    expect(html).toContain(TEXTO_SIN_FOTOS_DEL_SERVICIO);
    expect(html).not.toContain("<img");
  });

  it.each(["confirmada", "pendiente", "cancelada", "expirada", "pendiente_de_cierre"])("reserva %s: no muestra la sección", (estado) => {
    expect(render(estado, [])).toBe("");
    expect(render(estado, CINCO)).toBe("");
  });

  it("el HTML no trae ruta de Blob ni URL de almacenamiento", () => {
    const html = render("completada", [{ id: "f1", ambiente: "cocina", etiqueta: "Cocina", ruta: "fotos/r1/secreta.webp" } as never]);
    expect(html).not.toContain("fotos/r1");
    expect(html).not.toContain("secreta");
    expect(html).not.toMatch(/blob\.vercel|vercel-storage|https?:\/\//);
  });
});

const detalle = (extra: Partial<DetalleReserva> = {}): DetalleReserva => ({
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
  puede_resenar: false,
  fotos: [],
  ...extra,
});
const pagina = (d: DetalleReserva) => renderToStaticMarkup(createElement(DetalleVista, { detalle: d, zona: "America/Lima", whatsapp: null, sinCambios: false }));

describe("detalle de la reserva con fotos", () => {
  it("una completada con fotos las muestra en el espacio del detalle", () => {
    const html = pagina(detalle({ fotos: CINCO }));
    expect((html.match(/src="\/api\/fotos\//g) ?? []).length).toBe(5);
  });

  it("una completada sin fotos dice que aún no hay", () => {
    expect(pagina(detalle())).toContain(TEXTO_SIN_FOTOS_DEL_SERVICIO);
  });

  it("una confirmada no muestra la sección", () => {
    const html = pagina(detalle({ estado: "confirmada", estado_texto: "Confirmada" }));
    expect(html).not.toContain('aria-label="Fotos del servicio"');
    expect(html).not.toContain(TEXTO_SIN_FOTOS_DEL_SERVICIO);
  });
});

const hist = (extra: Partial<HistorialVista> = {}): HistorialVista => ({ ...detalle(), resena_estado: null, total_fotos: 0, ...extra });
const perfil = (historial: HistorialVista[]): RespuestaPerfil =>
  ({ membresia: { estado: "sin_membresia", plazo_vencido: false }, renovacion: { estado: "no_aplica" }, avisos: [], proximas: [], historial, credito: { saldo_horas: 0, proximo_vencimiento: null, membresia_vencida: false } }) as unknown as RespuestaPerfil;
const cuenta = (historial: HistorialVista[]) =>
  renderToStaticMarkup(createElement(PerfilVista, { usuario: { id: "u1", nombre: "Ana", correo: "ana@tiza.test", celular: "987654321" }, perfil: perfil(historial), zona: "America/Lima" }));

describe("historial con la cantidad de fotos", () => {
  it("una reserva con 4 fotos dice «4 fotos» y enlaza al detalle, sin cargar imágenes", () => {
    const html = cuenta([hist({ total_fotos: 4 })]);
    expect(html).toContain("4 fotos");
    expect(html).toMatch(/<a[^>]*href="\/cuenta\/reservas\/r1"[^>]*>4 fotos<\/a>/);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("/api/fotos");
  });

  it("con una sola foto usa el singular", () => {
    expect(cuenta([hist({ total_fotos: 1 })])).toContain(">1 foto<");
  });

  it("sin fotos no muestra el contador", () => {
    const html = cuenta([hist({ total_fotos: 0 })]);
    expect(html).not.toMatch(/\d+ fotos?</);
  });

  it("no hay ruta de Blob en el HTML del historial", () => {
    expect(cuenta([hist({ total_fotos: 3 })])).not.toMatch(/ruta|blob\.vercel|vercel-storage/i);
  });
});
