import { describe, expect, it } from "vitest";
import { validar } from "../validacion-sesion";
import { esquemaReserva } from "./esquema-entrada";

const valido = () => ({
  servicio: { tipo: "profunda", dormitorios: 2, banos: 1 },
  inicio: "2026-11-07T10:00:00-05:00",
  direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123" },
  metodo: "yape",
  comprobante: "comprobantes/u1/recibo-abc.jpg",
});

const mensaje = (cuerpo: unknown) => {
  try {
    validar(esquemaReserva, cuerpo);
    return null;
  } catch (e) {
    expect(e).toMatchObject({ status: 422 });
    return (e as Error).message;
  }
};

describe("esquemaReserva", () => {
  it("acepta un cuerpo válido", () => {
    expect(mensaje(valido())).toBeNull();
    expect(mensaje({ ...valido(), servicio: { tipo: "paquete", horas: 3 }, metodo: "transferencia" })).toBeNull();
  });

  it("sin comprobante pide subirlo", () => {
    const { comprobante: _c, ...sin } = valido();
    expect(mensaje(sin)).toMatch(/comprobante/i);
    expect(mensaje({ ...valido(), comprobante: "" })).toMatch(/comprobante/i);
  });

  it.each(["tarjeta", "credito", undefined, 5])("rechaza el método %s", (metodo) => {
    expect(mensaje({ ...valido(), metodo })).toMatch(/Yape o transferencia/);
  });

  it("rechaza un inicio sin zona horaria o con formato inválido", () => {
    expect(mensaje({ ...valido(), inicio: "2026-11-07T10:00:00" })).toMatch(/día y la hora/);
    expect(mensaje({ ...valido(), inicio: "mañana" })).toMatch(/día y la hora/);
    expect(mensaje({ ...valido(), inicio: undefined })).toMatch(/día y la hora/);
  });

  it("rechaza un tipo de servicio inválido", () => {
    expect(mensaje({ ...valido(), servicio: { tipo: "lujo", dormitorios: 1, banos: 1 } })).toMatch(/tipo de servicio/);
  });

  it("rechaza un servicio por tamaño sin baños y un paquete sin horas", () => {
    expect(mensaje({ ...valido(), servicio: { tipo: "estandar", dormitorios: 2 } })).toMatch(/baños/);
    expect(mensaje({ ...valido(), servicio: { tipo: "paquete" } })).toMatch(/horas/);
  });

  it("descarta los campos de monto, descuento y horas gratis", () => {
    const datos = validar(esquemaReserva, { ...valido(), monto: 1, descuento: 99, horas_gratis: 10, servicio: { ...valido().servicio, precio: 1 } });
    expect(Object.keys(datos).sort()).toEqual(["comprobante", "direccion", "inicio", "metodo", "servicio"]);
    expect(datos.servicio).toEqual({ tipo: "profunda", dormitorios: 2, banos: 1 });
  });

  it("limita el largo de la ruta del comprobante", () => {
    expect(mensaje({ ...valido(), comprobante: "a".repeat(301) })).toMatch(/no es válida/);
  });
});
