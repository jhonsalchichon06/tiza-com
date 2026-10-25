import { describe, expect, it } from "vitest";
import { destinoSeguro } from "@/lib/volver";
import { rutaDeVolver } from "./parametros";
import { decidirVista } from "./vista";

const USUARIO = { id: "u1" };
const activa = (vigente: boolean) => ({ estado: "activa" as const, vigente });
const pendiente = { estado: "pendiente" as const, vigente: false };
const caducada = { estado: "caducada" as const, vigente: false };

describe("decidirVista", () => {
  it("sin sesión redirige", () => expect(decidirVista(null, [])).toBe("redirigir"));
  it("sin membresía muestra el asistente", () => expect(decidirVista(USUARIO, [])).toBe("asistente"));
  it("con membresía pendiente avisa que el pago está en revisión", () => expect(decidirVista(USUARIO, [pendiente])).toBe("pago_en_revision"));
  it("una membresía caducada no cuenta: el cliente empieza de nuevo", () => expect(decidirVista(USUARIO, [caducada])).toBe("asistente"));
  it("una activa vigente es un miembro", () => expect(decidirVista(USUARIO, [activa(true)])).toBe("miembro"));
  it("una activa vencida muestra que la membresía venció", () => expect(decidirVista(USUARIO, [activa(false)])).toBe("membresia_vencida"));
  it("activa vigente y pendiente: gana la activa", () => expect(decidirVista(USUARIO, [pendiente, activa(true)])).toBe("miembro"));
  it("activa vencida y pendiente: el pago está en revisión", () => expect(decidirVista(USUARIO, [activa(false), pendiente])).toBe("pago_en_revision"));
  it("la activa vigente gana aunque haya otra vencida", () => expect(decidirVista(USUARIO, [activa(false), activa(true)])).toBe("miembro"));
  it("sin sesión gana sobre cualquier membresía", () => expect(decidirVista(null, [activa(true)])).toBe("redirigir"));
});

describe("ruta de volver", () => {
  it("el redirect a /registro conserva la ruta y sus parámetros, y es un destino seguro", () => {
    const volver = rutaDeVolver({ tipo: "profunda", distrito: "Lince" });
    const destino = `/registro?volver=${encodeURIComponent(volver)}`;
    expect(destino).toBe("/registro?volver=%2Freservar%3Ftipo%3Dprofunda%26distrito%3DLince");
    const recibido = new URL(destino, "http://x").searchParams.get("volver");
    expect(destinoSeguro(recibido)).toBe("/reservar?tipo=profunda&distrito=Lince");
  });
});
