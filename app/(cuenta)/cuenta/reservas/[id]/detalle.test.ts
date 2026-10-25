import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorApi } from "@/lib/errores";
import type { DetalleReserva } from "@/lib/perfil/detalle";
import { DetalleVista, TEXTO_SIN_CAMBIOS } from "./DetalleVista";
import { TEXTO_AVISO_APOYO, TEXTO_CONFIRMAR_CANCELACION, VistaAcciones } from "./AccionesReserva";

const mocks = vi.hoisted(() => ({
  usuario: vi.fn(),
  leer: vi.fn(),
}));
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
vi.mock("@/lib/perfil/detalle", () => ({ leerDetalleConZona: mocks.leer }));

const ZONA = "America/Lima";
const detalle = (extra: Partial<DetalleReserva> = {}): DetalleReserva => ({
  id: "r1",
  estado: "confirmada",
  estado_texto: "Confirmada",
  servicio: { tipo: "profunda", dormitorios: 2, banos: 1 },
  direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: "501", referencias: "Frente al parque" },
  inicio: "2026-12-15T10:00:00-05:00",
  fin: "2026-12-15T15:00:00-05:00",
  monto: 6966,
  precio_lista: 19350,
  horas_gratis_aplicadas: 3,
  requiere_apoyo: false,
  expira_en: null,
  enlace: "/cuenta/reservas/r1",
  puede_reprogramar: true,
  puede_cancelar: true,
  pago: { id: "p1", concepto: "membresia_y_reserva", monto: 33666, metodo: "yape", estado: "aprobado", motivo_rechazo: null, comprobante: "/api/comprobantes/p1" },
  resena: null,
  puede_resenar: false,
  fotos: [],
  ...extra,
});
const html = (d: DetalleReserva, whatsapp: string | null = null, sinCambios = false) => renderToStaticMarkup(createElement(DetalleVista, { detalle: d, zona: ZONA, whatsapp, sinCambios }));

describe("DetalleVista", () => {
  it("reserva propia: servicio, dirección, horario en Lima, precio, horas gratis y estado del pago", () => {
    const salida = html(detalle());
    expect(salida).toContain("martes 15 de diciembre, 10:00 am");
    expect(salida).toContain("Limpieza profunda");
    expect(salida).toContain("Av. Larco 123, Dpto. 501, Miraflores");
    expect(salida).toContain("Referencias: Frente al parque");
    expect(salida).toContain("Precio de lista: S/ 193,50");
    expect(salida).toContain("Horas gratis: 3 horas");
    expect(salida).toContain("Total a pagar: S/ 69,66");
    expect(salida).toContain("Aprobado");
    expect(salida).toContain('href="/api/comprobantes/p1"');
  });

  it("el espacio de fotos (ítem 17) ya no es un marcador: una reserva confirmada no muestra la sección de fotos", () => {
    const salida = html(detalle());
    expect(salida).not.toContain('aria-label="Fotos y reseña"');
    expect(salida).not.toContain('aria-label="Fotos del servicio"');
  });

  it("los botones salen solo con puede_reprogramar y puede_cancelar", () => {
    expect(html(detalle())).toContain("Cambiar día y hora");
    expect(html(detalle())).toContain("Cancelar reserva");
    const sin = html(detalle({ puede_reprogramar: false, puede_cancelar: false }));
    expect(sin).not.toContain("Cambiar día y hora");
    expect(sin).not.toContain("Cancelar reserva");
    const soloCancelar = html(detalle({ puede_reprogramar: false }));
    expect(soloCancelar).not.toContain("Cambiar día y hora");
    expect(soloCancelar).toContain("Cancelar reserva");
  });

  it("con menos del plazo: el mensaje de WhatsApp con el enlace y sin botones", () => {
    const salida = html(detalle({ puede_reprogramar: false, puede_cancelar: false }), "https://wa.me/51987654321?text=Hola", true);
    expect(TEXTO_SIN_CAMBIOS).toBe("Ya no puedes cambiarla desde aquí. Escríbenos por WhatsApp.");
    expect(salida).toContain(TEXTO_SIN_CAMBIOS);
    expect(salida).toContain('href="https://wa.me/51987654321?text=Hola"');
    expect(salida).not.toContain("Cancelar reserva");
  });

  it("sin costo, pago rechazado con motivo y pendiente con hora límite", () => {
    const salida = html(detalle({ monto: 0, horas_gratis_aplicadas: 0, estado: "pendiente", estado_texto: "Esperando la aprobación de tu pago", expira_en: "2026-11-03T20:00:00-05:00", pago: { id: "p2", concepto: "reserva", monto: 12900, metodo: "transferencia", estado: "rechazado", motivo_rechazo: "Borroso", comprobante: null } }));
    expect(salida).toContain("Sin costo");
    expect(salida).toContain("Motivo del rechazo: Borroso");
    expect(salida).toContain("hasta el martes 3 de noviembre, 8:00 pm");
    expect(salida).not.toContain("Ver mi comprobante");
  });

  it("no muestra el equipo", () => {
    expect(html(detalle())).not.toMatch(/equipo/i);
  });
});

describe("VistaAcciones", () => {
  const base = {
    puedeCancelar: true,
    puedeReprogramar: true,
    requiereApoyo: false,
    zona: ZONA,
    modo: "inicio" as const,
    enviando: false,
    mensaje: null,
    whatsapp: null,
    resultado: null,
    fecha: "",
    horarios: null,
    cargandoHorarios: false,
    atendido: true,
    elegido: null,
    onModo() {},
    onCancelar() {},
    onFecha() {},
    onElegir() {},
    onConfirmarCambio() {},
  };
  const vista = (extra: Partial<Parameters<typeof VistaAcciones>[0]> = {}) => renderToStaticMarkup(createElement(VistaAcciones, { ...base, ...extra }));

  it("cancelar en dos pasos: primero la pregunta con 'Sí, cancelar' y 'No, volver'", () => {
    expect(vista()).not.toContain(TEXTO_CONFIRMAR_CANCELACION);
    const paso2 = vista({ modo: "confirmar_cancelacion" });
    expect(paso2).toContain("¿Seguro que quieres cancelar?");
    expect(paso2).toContain("Sí, cancelar");
    expect(paso2).toContain("No, volver");
  });

  it("durante la cancelación los botones se deshabilitan", () => {
    expect(vista({ modo: "confirmar_cancelacion", enviando: true })).toMatch(/<button[^>]*disabled[^>]*>Cancelando\.\.\.<\/button>/);
  });

  it("resultado de cancelar: limpieza gratis conservada y mensaje del crédito", () => {
    const salida = vista({ resultado: { tipo: "cancelada", limpiezaGratisConservada: true, mensajeCredito: "Te devolvimos 4 horas como crédito. Puedes usarlas hasta el 5 de febrero de 2027." } });
    expect(salida).toContain("Tu reserva fue cancelada.");
    expect(salida).toContain("Tu limpieza gratis no se pierde");
    expect(salida).toContain("Te devolvimos 4 horas como crédito. Puedes usarlas hasta el 5 de febrero de 2027.");
  });

  it("cambiar día y hora: horarios sin cupo o con poca anticipación en gris y deshabilitados", () => {
    const salida = vista({
      modo: "cambiar",
      fecha: "2026-11-06",
      elegido: "2026-11-06T11:00:00-05:00",
      horarios: [
        { hora: "10:00", inicio: "2026-11-06T10:00:00-05:00", disponible: false, motivo: "sin_cupo" },
        { hora: "11:00", inicio: "2026-11-06T11:00:00-05:00", disponible: true },
        { hora: "12:00", inicio: "2026-11-06T12:00:00-05:00", disponible: false, motivo: "anticipacion" },
      ],
    });
    expect(salida).toMatch(/<button[^>]*disabled[^>]*>10:00<\/button>/);
    expect(salida).toMatch(/<button[^>]*aria-pressed="true"[^>]*>11:00<\/button>/);
    expect(salida).not.toMatch(/<button[^>]*disabled[^>]*>11:00<\/button>/);
    expect(salida).toMatch(/<button[^>]*disabled[^>]*>12:00<\/button>/);
    expect(salida).toContain("Confirmar el cambio");
  });

  it("sin elegir horario, confirmar el cambio está deshabilitado", () => {
    expect(vista({ modo: "cambiar" })).toMatch(/<button[^>]*disabled[^>]*>Confirmar el cambio<\/button>/);
  });

  it("si la reserva requiere apoyo avisa que el equipo volverá a coordinarlo", () => {
    expect(vista({ modo: "cambiar", requiereApoyo: true })).toContain(TEXTO_AVISO_APOYO);
    expect(vista({ modo: "cambiar" })).not.toContain(TEXTO_AVISO_APOYO);
  });

  it("muestra el mensaje del servidor y el enlace de WhatsApp si hay", () => {
    const salida = vista({ mensaje: "Esa hora ya no está disponible. Elige otra hora.", whatsapp: "https://wa.me/519?text=Hola" });
    expect(salida).toContain("Esa hora ya no está disponible. Elige otra hora.");
    expect(salida).toContain('href="https://wa.me/519?text=Hola"');
  });

  it("después de reprogramar muestra el nuevo horario y recuerda la espera del pago si está pendiente", () => {
    const salida = vista({ resultado: { tipo: "reprogramada", inicio: "2026-11-06T10:00:00-05:00", pendiente: true } });
    expect(salida).toContain("viernes 6 de noviembre, 10:00 am");
    expect(salida).toContain("Sigue esperando la aprobación de tu pago.");
  });

  it("el día que no se atiende lo dice", () => {
    expect(vista({ modo: "cambiar", horarios: [], atendido: false })).toContain("Ese día no atendemos");
  });
});

describe("página /cuenta/reservas/[id]", () => {
  beforeEach(() => {
    mocks.usuario.mockReset();
    mocks.leer.mockReset();
  });
  const USUARIO = { id: "u1", correo: "a@tiza.test", nombre: "Ana", celular: "999111222", rol: "cliente" };
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("sin sesión redirige a ingresar", async () => {
    mocks.usuario.mockResolvedValue(null);
    const { default: Pagina } = await import("./page");
    await expect(Pagina(params("11111111-1111-4111-8111-111111111111"))).rejects.toThrow(/REDIRECT:\/ingresar\?volver=/);
  });

  it("una reserva ajena (404 de la lectura) da la página de no encontrada", async () => {
    mocks.usuario.mockResolvedValue(USUARIO);
    mocks.leer.mockRejectedValue(ErrorApi.noEncontrado("No encontramos esa reserva."));
    const { default: Pagina } = await import("./page");
    await expect(Pagina(params("11111111-1111-4111-8111-111111111111"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.leer).toHaveBeenCalledWith(expect.objectContaining({ usuario: USUARIO }));
  });

  it("otro error no se disfraza de no encontrada", async () => {
    mocks.usuario.mockResolvedValue(USUARIO);
    mocks.leer.mockRejectedValue(ErrorApi.noDisponible());
    const { default: Pagina } = await import("./page");
    await expect(Pagina(params("11111111-1111-4111-8111-111111111111"))).rejects.toMatchObject({ status: 503 });
  });

  it("la reserva propia se renderiza", async () => {
    mocks.usuario.mockResolvedValue(USUARIO);
    mocks.leer.mockResolvedValue({ detalle: detalle(), zona: ZONA });
    const { default: Pagina } = await import("./page");
    const elemento = await Pagina(params("11111111-1111-4111-8111-111111111111"));
    expect(renderToStaticMarkup(elemento)).toContain("Limpieza profunda");
  });
});
