import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { instanteLocal } from "../agenda/horario";
import { cotizarPrimeraReserva, cotizarReservaDeMiembro } from "./cotizar";

const AHORA = instanteLocal("2026-11-02", "10:00", "America/Lima"); // lunes
const cotizar = (servicio: Parameters<typeof cotizarPrimeraReserva>[1], config = VALORES_DEL_DISENO, ahora = AHORA) =>
  cotizarPrimeraReserva(config, servicio, ahora);

describe("cotizarPrimeraReserva", () => {
  it("profunda 2/1: 5 h, 19350, 3 h gratis, monto 6966, membresía 26700 y total 33666", () => {
    const c = cotizar({ tipo: "profunda", dormitorios: 2, banos: 1 });
    expect(c).toMatchObject({
      horas_trabajo: 5,
      precio_lista: 19350,
      horas_gratis_aplicadas: 3,
      monto: 6966,
      membresia: { mensual: 8900, meses: 3, total: 26700 },
      total_a_pagar: 33666,
      espera_pago_horas: 24,
    });
  });

  it.each([
    ["estándar 1/1", { tipo: "estandar", dormitorios: 1, banos: 1 } as const],
    ["paquete de 3 h", { tipo: "paquete", horas: 3 } as const],
  ])("%s: monto 0 y total 26700", (_n, servicio) => {
    const c = cotizar(servicio);
    expect(c.monto).toBe(0);
    expect(c.total_a_pagar).toBe(26700);
  });

  it("estándar 0/1: 2 h, 6600 y 2 horas gratis", () => {
    const c = cotizar({ tipo: "estandar", dormitorios: 0, banos: 1 });
    expect(c).toMatchObject({ horas_trabajo: 2, precio_lista: 6600, horas_gratis_aplicadas: 2, monto: 0 });
  });

  it("estándar, profunda y mudanza 2/1 duran 4, 5 y 6 h con 12900, 19350 y 21930", () => {
    const [e, p, m] = (["estandar", "profunda", "mudanza"] as const).map((tipo) => cotizar({ tipo, dormitorios: 2, banos: 1 }));
    expect([e.horas_trabajo, p.horas_trabajo, m.horas_trabajo]).toEqual([4, 5, 6]);
    expect([e.precio_lista, p.precio_lista, m.precio_lista]).toEqual([12900, 19350, 21930]);
  });

  it("mudanza 3/1: 8 h de trabajo, 4 h de agenda y apoyo", () => {
    const c = cotizar({ tipo: "mudanza", dormitorios: 3, banos: 1 });
    expect(c).toMatchObject({ horas_trabajo: 8, horas_agenda: 4, requiere_apoyo: true });
  });

  it("rango de fechas y límite con la petición del lunes 2 de noviembre de 2026 a las 10:00", () => {
    const c = cotizar({ tipo: "estandar", dormitorios: 1, banos: 1 });
    expect(c.fechas).toEqual({ desde: "2026-11-04", hasta: "2027-02-02" });
    expect(c.limite).toBe("2027-02-02T10:00:00-05:00");
  });

  it("otro precio y otros meses cambian la membresía y el total", () => {
    const c = cotizar(
      { tipo: "profunda", dormitorios: 2, banos: 1 },
      { ...VALORES_DEL_DISENO, membresia_precio_mensual: 10000, membresia_meses: 2 },
    );
    expect(c.membresia).toEqual({ mensual: 10000, meses: 2, total: 20000 });
    expect(c.total_a_pagar).toBe(20000 + 6966);
    expect(c.fechas.hasta).toBe("2027-01-02");
  });

  it("sin la cuarta opción aplica la gratis y el motivo es null", () => {
    expect(cotizar({ tipo: "profunda", dormitorios: 2, banos: 1 })).toMatchObject({ aplica_gratis: true, motivo_sin_gratis: null });
  });

  it.each(["cliente", "hogar"] as const)("con aplicaGratis falso (motivo %s): 0 horas gratis, monto 17415 y total 44115", (motivo) => {
    const c = cotizarPrimeraReserva(VALORES_DEL_DISENO, { tipo: "profunda", dormitorios: 2, banos: 1 }, AHORA, { aplicaGratis: false, motivoSinGratis: motivo });
    expect(c).toMatchObject({ aplica_gratis: false, motivo_sin_gratis: motivo, horas_gratis_aplicadas: 0, monto: 17415, total_a_pagar: 44115 });
  });

  it("un servicio inválido da 422", () => {
    expect(() => cotizar({ tipo: "paquete", horas: 5 })).toThrow(/paquete/);
    expect(() => cotizar({ tipo: "estandar", dormitorios: 1, banos: 0 })).toThrow(/baño/);
  });
});

describe("cotizarReservaDeMiembro", () => {
  const FIN_LEJANO = instanteLocal("2027-01-20", "10:00", "America/Lima");
  const miembro = (
    servicio: Parameters<typeof cotizarReservaDeMiembro>[1],
    opciones: Partial<Parameters<typeof cotizarReservaDeMiembro>[3]> = {},
    config = VALORES_DEL_DISENO,
    ahora = AHORA,
  ) => cotizarReservaDeMiembro(config, servicio, ahora, { membresiaFin: FIN_LEJANO, ...opciones });

  it("estándar 2/1 sin gratis: lista 12900, descuento 1290, monto 11610, sin membresía en el total", () => {
    const c = miembro({ tipo: "estandar", dormitorios: 2, banos: 1 });
    expect(c).toMatchObject({ modo: "miembro", membresia: null, precio_lista: 12900, descuento: 1290, monto: 11610, total_a_pagar: 11610, aplica_gratis: false });
  });

  it("profunda 2/1 sin gratis: 17415", () => {
    expect(miembro({ tipo: "profunda", dormitorios: 2, banos: 1 }).monto).toBe(17415);
  });

  it("paquete de 4 h: 11610", () => {
    expect(miembro({ tipo: "paquete", horas: 4 }).monto).toBe(11610);
  });

  it("con gratis y 5 h: 6966; con gratis y 3 h: 0", () => {
    expect(miembro({ tipo: "profunda", dormitorios: 2, banos: 1 }, { aplicaGratis: true })).toMatchObject({ monto: 6966, horas_gratis_aplicadas: 3 });
    expect(miembro({ tipo: "estandar", dormitorios: 1, banos: 1 }, { aplicaGratis: true })).toMatchObject({ monto: 0, total_a_pagar: 0 });
  });

  it("el motivo sin gratis solo se informa cuando no aplica", () => {
    expect(miembro({ tipo: "paquete", horas: 4 }, { motivoSinGratis: "cliente" }).motivo_sin_gratis).toBe("cliente");
    expect(miembro({ tipo: "paquete", horas: 4 }, { aplicaGratis: true, motivoSinGratis: "cliente" }).motivo_sin_gratis).toBeNull();
  });

  it("descuento_miembro en 0,15 cambia el monto", () => {
    const c = miembro({ tipo: "estandar", dormitorios: 2, banos: 1 }, {}, { ...VALORES_DEL_DISENO, descuento_miembro: 0.15 });
    expect(c).toMatchObject({ descuento: 1935, monto: 10965 });
  });

  it("fin a 10 días: hasta es el día del fin si termina a las 10:00; el día anterior si termina a medianoche", () => {
    const diez = new Date(AHORA.getTime() + 10 * 86_400_000);
    expect(miembro({ tipo: "paquete", horas: 4 }, { membresiaFin: diez }).fechas.hasta).toBe("2026-11-12");
    const medianoche = instanteLocal("2026-11-12", "00:00", "America/Lima");
    expect(miembro({ tipo: "paquete", horas: 4 }, { membresiaFin: medianoche }).fechas.hasta).toBe("2026-11-11");
    expect(miembro({ tipo: "paquete", horas: 4 }, { membresiaFin: diez })).toMatchObject({ limite: "2026-11-12T10:00:00-05:00", membresia_fin: "2026-11-12T10:00:00-05:00", membresia_vigente: true });
  });

  it("fin pasado: membresia_vigente falso y hasta anterior a desde", () => {
    const c = miembro({ tipo: "paquete", horas: 4 }, { membresiaFin: new Date(AHORA.getTime() - 86_400_000) });
    expect(c.membresia_vigente).toBe(false);
    expect(c.fechas.hasta < c.fechas.desde).toBe(true);
  });

  it("fin dentro de las 48 horas: no hay días reservables", () => {
    const c = miembro({ tipo: "paquete", horas: 4 }, { membresiaFin: new Date(AHORA.getTime() + 30 * 3_600_000) });
    expect(c.membresia_vigente).toBe(true);
    expect(c.fechas.hasta < c.fechas.desde).toBe(true);
  });

  describe("crédito en horas", () => {
    const estandar = { tipo: "estandar", dormitorios: 2, banos: 1 } as const; // 4 h

    it("sin crédito: nada aplicado y no cubierta", () => {
      expect(miembro(estandar)).toMatchObject({ credito_disponible: 0, credito_aplicado: 0, cubierta_por_credito: false, monto: 11610 });
    });

    it("parcial: resta horas a cobrar y no queda cubierta", () => {
      const c = miembro(estandar, { creditoHoras: 2 });
      expect(c).toMatchObject({ credito_disponible: 2, credito_aplicado: 2, horas_cobrar: 2, monto: 5805, cubierta_por_credito: false });
    });

    it("cubierta: el saldo alcanza para todo y el monto es 0", () => {
      const c = miembro(estandar, { creditoHoras: 6 });
      expect(c).toMatchObject({ credito_disponible: 6, credito_aplicado: 4, monto: 0, total_a_pagar: 0, cubierta_por_credito: true });
    });

    it("con horas gratis conservadas: las 3 gratis van primero y el crédito cubre el resto", () => {
      const c = miembro({ tipo: "profunda", dormitorios: 2, banos: 1 }, { aplicaGratis: true, creditoHoras: 2 }); // 5 h
      expect(c).toMatchObject({ horas_gratis_aplicadas: 3, credito_aplicado: 2, monto: 0, cubierta_por_credito: true });
    });

    it("con horas gratis que cubren todo no usa el crédito ni se marca cubierta por crédito", () => {
      const c = miembro({ tipo: "paquete", horas: 3 }, { aplicaGratis: true, creditoHoras: 2 });
      expect(c).toMatchObject({ credito_aplicado: 0, monto: 0, cubierta_por_credito: false });
    });
  });

  it("la cotización de la primera membresía no cambia: modo primera y membresía en el total", () => {
    const c = cotizar({ tipo: "profunda", dormitorios: 2, banos: 1 });
    expect(c.modo).toBe("primera");
    expect(c.total_a_pagar).toBe(33666);
  });
});
