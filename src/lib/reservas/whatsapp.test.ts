import { describe, expect, it } from "vitest";
import { instanteLocal } from "../agenda/horario";
import { enlaceWhatsapp, mensajeDeReserva } from "./whatsapp";

// El número de estas pruebas es un ejemplo, no el real.
const NUMERO = "51912345678";

describe("enlaceWhatsapp", () => {
  it("arma https://wa.me/<número>?text= con el texto codificado", () => {
    const enlace = enlaceWhatsapp({ numero: NUMERO, mensaje: "Hola, ¿cómo estás?\nReservé una limpieza" })!;
    expect(enlace.startsWith(`https://wa.me/${NUMERO}?text=`)).toBe(true);
    expect(decodeURIComponent(enlace.split("?text=")[1])).toBe("Hola, ¿cómo estás?\nReservé una limpieza");
    expect(enlace).not.toMatch(/\s/);
  });

  it.each([undefined, null, "", "5191234abcd", "+51912345678", "51 912 345 678"])("da null con el número %s", (numero) => {
    expect(enlaceWhatsapp({ numero, mensaje: "Hola" })).toBeNull();
  });
});

describe("mensajeDeReserva", () => {
  const inicio = instanteLocal("2026-11-07", "10:00", "America/Lima");
  const datos = {
    estado: "pendiente" as const,
    nombre: "María Pérez",
    celular: "987654321",
    servicio: { tipo: "profunda" as const },
    inicio,
    zona: "America/Lima",
    distrito: "San Borja",
    calle: "Av. Aviación",
    numero: "2530",
    departamento: "Dpto. 302",
  };

  it("nombra al cliente, el servicio, el día, la hora, la dirección y el estado", () => {
    const m = mensajeDeReserva(datos);
    expect(m).toContain("María Pérez");
    expect(m).toContain("987654321");
    expect(m).toContain("Limpieza profunda");
    expect(m).toContain("7 de noviembre de 2026");
    expect(m).toContain("10:00");
    expect(m).toContain("Av. Aviación 2530, Dpto. 302, San Borja");
    expect(m).toContain("en espera");
  });

  it("según el estado: en espera de la aprobación o confirmada, sin montos en ninguno", () => {
    const pendiente = mensajeDeReserva({ ...datos, estado: "pendiente" });
    const confirmada = mensajeDeReserva({ ...datos, estado: "confirmada" });
    expect(pendiente).toContain("Estado: en espera de la aprobación de mi pago.");
    expect(confirmada).toContain("Estado: confirmada.");
    expect(confirmada).not.toMatch(/aprobación|en espera/);
    expect(pendiente).not.toContain("S/");
    expect(confirmada).not.toContain("S/");
  });

  it("no lleva montos", () => {
    expect(mensajeDeReserva(datos)).not.toMatch(/S\/|soles|monto|precio/i);
  });

  it("el paquete dice sus horas y una casa sin departamento no deja comas sobrantes", () => {
    const m = mensajeDeReserva({ ...datos, servicio: { tipo: "paquete", horas: 6 }, departamento: null });
    expect(m).toContain("Paquete de 6 horas");
    expect(m).toContain("Av. Aviación 2530, San Borja");
  });

  it("con tildes y saltos de línea se codifica y se decodifica igual en el enlace", () => {
    const m = mensajeDeReserva(datos);
    const enlace = enlaceWhatsapp({ numero: NUMERO, mensaje: m })!;
    expect(decodeURIComponent(enlace.split("?text=")[1])).toBe(m);
  });
});
