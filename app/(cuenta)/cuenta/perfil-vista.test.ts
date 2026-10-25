import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Aviso } from "@/lib/perfil/avisos";
import type { MembresiaDelPerfil } from "@/lib/perfil/membresia";
import type { HistorialVista, ProximaVista, ReservaVista } from "@/lib/perfil/reservas";
import type { RespuestaPerfil } from "@/lib/perfil/resumen";
import { PerfilVista } from "./PerfilVista";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const ZONA = "America/Lima";
const USUARIO = { id: "u1", nombre: "Ana", correo: "ana@tiza.test", celular: "999111222" };

const reserva = (extra: Partial<ReservaVista> = {}): ReservaVista => ({
  id: "r1",
  estado: "confirmada",
  estado_texto: "Confirmada",
  servicio: { tipo: "estandar", dormitorios: 2, banos: 1 },
  direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: "501", referencias: null },
  inicio: "2026-12-15T10:00:00-05:00",
  fin: "2026-12-15T14:00:00-05:00",
  monto: 12900,
  precio_lista: 12900,
  horas_gratis_aplicadas: 0,
  requiere_apoyo: false,
  expira_en: null,
  enlace: "/cuenta/reservas/r1",
  ...extra,
});
const hist = (extra: Partial<HistorialVista> = {}): HistorialVista => ({ ...reserva(), resena_estado: null, total_fotos: 0, ...extra });
const proxima = (extra: Partial<ProximaVista> = {}): ProximaVista => ({ ...reserva(), puede_reprogramar: true, puede_cancelar: true, ...extra });
const perfil = (extra: Partial<RespuestaPerfil> = {}): RespuestaPerfil => ({
  membresia: { estado: "sin_membresia", plazo_vencido: false },
  renovacion: { estado: "no_aplica" },
  avisos: [],
  proximas: [],
  historial: [],
  credito: { saldo_horas: 0, proximo_vencimiento: null, membresia_vencida: false },
  ...extra,
});
const html = (p: RespuestaPerfil) => renderToStaticMarkup(createElement(PerfilVista, { usuario: USUARIO, perfil: p, zona: ZONA }));

describe("PerfilVista: membresía", () => {
  it.each<[string, MembresiaDelPerfil, RegExp]>([
    ["activa", { estado: "activa", inicio: "2026-10-01T10:00:00-05:00", fin: "2026-12-30T10:00:00-05:00", dias_restantes: 40 }, /Tu membresía está activa hasta el 30 de diciembre de 2026[\s\S]*quedan 40 días/],
    ["activa con 1 día", { estado: "activa", inicio: "2026-10-01T10:00:00-05:00", fin: "2026-12-30T10:00:00-05:00", dias_restantes: 1 }, /Te queda 1 día/],
    ["vencida", { estado: "vencida", fin: "2026-10-01T10:00:00-05:00" }, /Tu membresía venció el 1 de octubre de 2026/],
    ["en revisión", { estado: "en_revision", pago_id: "p1" }, /Tu membresía está en revisión/],
    ["pago rechazado", { estado: "pago_rechazado", pago_id: "p1", motivo_rechazo: null, reenvio_hasta: "2026-11-09T10:00:00-05:00" }, /Tu comprobante fue rechazado/],
    ["sin membresía", { estado: "sin_membresia", plazo_vencido: false }, /Aún no eres miembro de Tiza Club/],
  ])("%s", (_n, membresia, patron) => {
    expect(html(perfil({ membresia }))).toMatch(patron);
  });

  it("sin membresía ofrece reservar; vencida no ofrece reservar", () => {
    expect(html(perfil())).toContain('href="/reservar"');
    expect(html(perfil({ membresia: { estado: "vencida", fin: "2026-10-01T10:00:00-05:00" } }))).not.toContain("Reservar mi primera limpieza");
  });
});

describe("PerfilVista: avisos", () => {
  it.each<Aviso>([
    { codigo: "en_revision", texto: "Tu pago está en revisión. Te avisaremos aquí cuando se apruebe." },
    { codigo: "nuevo_horario", texto: "Tu pago fue aprobado. Elige un nuevo día y hora para tu limpieza, no tienes que pagar otra vez.", pago_id: "p1" },
    { codigo: "limpieza_gratis_conservada", texto: "Tu limpieza gratis sigue disponible: tu próxima reserva llevará las 3 primeras horas sin costo." },
    { codigo: "vencida", texto: "Tu membresía venció el 1 de octubre de 2026." },
    { codigo: "plazo_vencido", texto: "Pasó el plazo para subir otro comprobante. Puedes empezar de nuevo con una reserva y un pago nuevos.", enlace: { texto: "Empezar de nuevo", href: "/reservar" } },
  ])("muestra el aviso $codigo", (aviso) => {
    const salida = html(perfil({ avisos: [aviso] }));
    expect(salida).toContain(aviso.texto);
    expect(salida).toContain(`data-aviso="${aviso.codigo}"`);
  });

  it("sin avisos no hay sección de avisos", () => {
    expect(html(perfil())).not.toContain('aria-label="Avisos"');
  });
});

describe("PerfilVista: listas", () => {
  it("sin reservas dice 'No tienes limpiezas próximas' y 'Aún no tienes historial'", () => {
    const salida = html(perfil());
    expect(salida).toContain("No tienes limpiezas próximas");
    expect(salida).toContain("Aún no tienes historial");
  });

  it("una próxima: fecha en hora de Lima, servicio, dirección, monto en soles y enlace al detalle", () => {
    const salida = html(perfil({ proximas: [proxima()] }));
    expect(salida).toContain("martes 15 de diciembre, 10:00 am");
    expect(salida).toContain("Limpieza estándar");
    expect(salida).toContain("Av. Larco 123, Dpto. 501, Miraflores");
    expect(salida).toContain("S/ 129");
    expect(salida).toContain('href="/cuenta/reservas/r1"');
    expect(salida).not.toContain("No tienes limpiezas próximas");
  });

  it("una pendiente muestra el texto de espera y la hora límite", () => {
    const salida = html(perfil({ proximas: [proxima({ estado: "pendiente", estado_texto: "Esperando la aprobación de tu pago", expira_en: "2026-11-03T20:00:00-05:00" })] }));
    expect(salida).toContain("Esperando la aprobación de tu pago");
    expect(salida).toContain("hasta el martes 3 de noviembre, 8:00 pm");
  });

  it("una primera limpieza sin costo dice 'Sin costo'; un paquete muestra sus horas", () => {
    const salida = html(perfil({ proximas: [proxima({ monto: 0, servicio: { tipo: "paquete", horas: 3 } })] }));
    expect(salida).toContain("Sin costo");
    expect(salida).toContain("Paquete de 3 horas");
  });

  it("el historial muestra el estado de cada servicio", () => {
    const salida = html(perfil({ historial: [hist({ id: "h1", estado: "completada", estado_texto: "Completada", enlace: "/cuenta/reservas/h1" }), hist({ id: "h2", estado: "pendiente_de_cierre", estado_texto: "Servicio realizado, pendiente de cierre", enlace: "/cuenta/reservas/h2" })] }));
    expect(salida).toContain("Completada");
    expect(salida).toContain("Servicio realizado, pendiente de cierre");
    expect(salida).not.toContain("Aún no tienes historial");
  });

  it("el equipo no aparece", () => {
    const salida = html(perfil({ proximas: [proxima()], historial: [hist()] }));
    expect(salida).not.toMatch(/equipo/i);
  });
});

describe("página /cuenta", () => {
  const fuente = readFileSync(resolve(__dirname, "page.tsx"), "utf8");
  const todo = ["page.tsx", "PerfilVista.tsx", "Avisos.tsx", "ReenviarComprobante.tsx"].map((a) => readFileSync(resolve(__dirname, a), "utf8")).join("\n");

  it("redirige a /ingresar?volver=/cuenta sin sesión y conserva CerrarSesion", () => {
    expect(fuente).toContain('redirect("/ingresar?volver=/cuenta")');
    expect(fuente).toContain("<CerrarSesion");
  });

  it("lee con las funciones del servidor, sin llamar a su propia API por HTTP", () => {
    expect(fuente).toContain("leerPerfilConZona");
    expect(fuente).not.toMatch(/fetch\(/);
  });

  it("no importa nada de demo/ ni lee localStorage", () => {
    expect(todo).not.toMatch(/demo\//);
    expect(todo).not.toMatch(/localStorage/);
  });
});

describe("estilos", () => {
  const css = readFileSync(resolve(__dirname, "cuenta.module.css"), "utf8");
  it("letra base de al menos 18 px y botones de al menos 48 px", () => {
    expect(css).toMatch(/\.pagina\s*\{[^}]*font-size:\s*1\.125rem/);
    expect(css).toMatch(/\.boton\s*\{[^}]*min-height:\s*3rem/);
  });
});

describe("PerfilVista: tarjeta «Tu crédito» (ítem 14)", () => {
  it("con saldo muestra las horas, el vencimiento y el enlace al detalle", () => {
    const h = html(perfil({ credito: { saldo_horas: 2.5, proximo_vencimiento: { horas: 2.5, vence_en: "2027-02-02T10:00:00-05:00" }, membresia_vencida: false } }));
    expect(h).toContain("Tienes 2,5 horas de crédito");
    expect(h).toContain("2,5 horas vencen el 2 de febrero de 2027");
    expect(h).toContain('href="/cuenta/credito"');
    expect(h).not.toContain("Renuévala");
  });

  it("con 1 hora usa el singular", () => {
    expect(html(perfil({ credito: { saldo_horas: 1, proximo_vencimiento: null, membresia_vencida: false } }))).toContain("Tienes 1 hora de crédito");
  });

  it("sin saldo dice «No tienes crédito por ahora.» y no enlaza al detalle", () => {
    const h = html(perfil());
    expect(h).toContain("No tienes crédito por ahora.");
    expect(h).not.toContain("/cuenta/credito");
  });

  it("con la membresía vencida y saldo: avisa que hace falta renovar y no ofrece reservar", () => {
    const h = html(
      perfil({
        membresia: { estado: "vencida", fin: "2026-10-01T10:00:00-05:00" },
        credito: { saldo_horas: 4, proximo_vencimiento: { horas: 4, vence_en: "2027-02-02T10:00:00-05:00" }, membresia_vencida: true },
      }),
    );
    expect(h).toContain("Tienes 4 horas de crédito");
    expect(h).toContain("Tu membresía venció. Renuévala para poder usar tu crédito.");
    expect(h).not.toContain("Elegir día y hora");
    expect(h).not.toContain("Reservar mi primera limpieza");
  });
});
