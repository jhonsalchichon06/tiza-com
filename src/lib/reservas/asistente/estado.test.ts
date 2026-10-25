import { describe, expect, it } from "vitest";
import { MIEMBRO_ESTANDAR_2_1, MIEMBRO_SIN_COSTO, PROFUNDA_2_1, RESPUESTA_201 } from "./__dobles__/cotizaciones";
import { claveDeDireccion, estadoInicial, mensajeDeTamano, puedeAvanzar, reductor, servicioDeEstado, sinCosto, type Accion, type Estado } from "./estado";

const inicial = estadoInicial({ distrito: "", tipo: null, horas: null });
const aplicar = (estado: Estado, ...acciones: Accion[]) => acciones.reduce(reductor, estado);

const HORARIO = { hora: "09:00", inicio: "2026-11-09T09:00:00-05:00" };

describe("estado inicial", () => {
  it("arranca en el paso 1 con 1 dormitorio y 1 baño", () => {
    expect(inicial).toMatchObject({ paso: 1, tipo: null, dormitorios: 1, banos: 1, cotizacion: null });
  });

  it("aplica los valores de la landing", () => {
    const e = estadoInicial({ distrito: "Miraflores", tipo: "paquete", horas: 6 });
    expect(e).toMatchObject({ tipo: "paquete", horasPaquete: 6 });
    expect(e.direccion.distrito).toBe("Miraflores");
  });
});

describe("tamaño del hogar", () => {
  it("permite 0 dormitorios y exige al menos 1 baño", () => {
    const e = aplicar(inicial, { tipo: "elegir_servicio", servicio: "estandar" }, { tipo: "fijar_dormitorios", valor: 0 });
    expect(mensajeDeTamano(e)).toBeNull();
    expect(servicioDeEstado(e)).toEqual({ tipo: "estandar", dormitorios: 0, banos: 1 });
    expect(mensajeDeTamano(reductor(e, { tipo: "fijar_banos", valor: 0 }))).toMatch(/al menos 1 baño/);
  });

  it("rechaza dormitorios negativos, decimales o vacíos", () => {
    const base = aplicar(inicial, { tipo: "elegir_servicio", servicio: "profunda" });
    for (const valor of [-1, 1.5, null]) {
      const e = reductor(base, { tipo: "fijar_dormitorios", valor });
      expect(mensajeDeTamano(e)).toMatch(/dormitorios/);
      expect(servicioDeEstado(e)).toBeNull();
    }
  });

  it("un paquete no valida dormitorios ni baños", () => {
    const e = aplicar(inicial, { tipo: "elegir_servicio", servicio: "paquete" }, { tipo: "elegir_paquete", horas: 6 }, { tipo: "fijar_banos", valor: 0 });
    expect(mensajeDeTamano(e)).toBeNull();
    expect(servicioDeEstado(e)).toEqual({ tipo: "paquete", horas: 6 });
  });
});

describe("transiciones", () => {
  const conCotizacion = aplicar(
    inicial,
    { tipo: "elegir_servicio", servicio: "profunda" },
    { tipo: "cotizacion_lista", cotizacion: PROFUNDA_2_1() },
    { tipo: "elegir_dia", dia: "2026-11-09" },
    { tipo: "elegir_horario", horario: HORARIO },
  );

  it("cotizar con la dirección guarda su clave y conserva día y hora; las referencias no la cambian", () => {
    const dir = { distrito: "Miraflores", calle: " Av. Larco ", numero: "123", departamento: "", referencias: "frente al parque" };
    const clave = claveDeDireccion(dir);
    expect(claveDeDireccion({ ...dir, referencias: "otra" })).toBe(clave);
    expect(claveDeDireccion({ ...dir, departamento: "302" })).not.toBe(clave);
    const e = reductor(conCotizacion, { tipo: "cotizacion_con_direccion", cotizacion: { ...PROFUNDA_2_1(), aplica_gratis: false, motivo_sin_gratis: "hogar" }, clave });
    expect(e.direccionCotizada).toBe(clave);
    expect(e.cotizacion?.motivo_sin_gratis).toBe("hogar");
    expect(e.horario).toEqual(HORARIO);
    expect(e.dia).toBe("2026-11-09");
  });

  it("cambiar de servicio olvida la dirección cotizada", () => {
    const cotizada = reductor(conCotizacion, { tipo: "cotizacion_con_direccion", cotizacion: PROFUNDA_2_1(), clave: "k" });
    expect(reductor(cotizada, { tipo: "elegir_servicio", servicio: "mudanza" }).direccionCotizada).toBeNull();
  });

  it("gratis_usada pide cotizar de nuevo, descarta el comprobante y conserva el resto", () => {
    const antes = reductor(reductor(conCotizacion, { tipo: "cotizacion_con_direccion", cotizacion: PROFUNDA_2_1(), clave: "k" }), { tipo: "comprobante_subido", ruta: "comprobantes/u1/a.jpg" });
    const e = reductor(antes, { tipo: "gratis_usada", mensaje: "Revisa el precio" });
    expect(e).toMatchObject({ mensaje: "Revisa el precio", direccionCotizada: null, comprobante: null, bloqueado: false });
    expect(e.horario).toEqual(HORARIO);
  });

  it("cambiar de servicio limpia la cotización y el horario", () => {
    const e = reductor(conCotizacion, { tipo: "elegir_servicio", servicio: "mudanza" });
    expect(e.cotizacion).toBeNull();
    expect(e.horario).toBeNull();
    expect(e.dia).toBe("2026-11-09");
  });

  it("elegir el mismo servicio no limpia nada", () => {
    expect(reductor(conCotizacion, { tipo: "elegir_servicio", servicio: "profunda" })).toBe(conCotizacion);
  });

  it("cambiar el tamaño o el paquete limpia la cotización", () => {
    expect(reductor(conCotizacion, { tipo: "fijar_dormitorios", valor: 3 }).cotizacion).toBeNull();
    expect(reductor(conCotizacion, { tipo: "fijar_banos", valor: 2 }).cotizacion).toBeNull();
    expect(reductor(conCotizacion, { tipo: "elegir_paquete", horas: 4 }).cotizacion).toBeNull();
  });

  it("cambiar de día limpia el horario; elegir el mismo día lo conserva", () => {
    expect(reductor(conCotizacion, { tipo: "elegir_dia", dia: "2026-11-10" }).horario).toBeNull();
    expect(reductor(conCotizacion, { tipo: "elegir_dia", dia: "2026-11-09" }).horario).toEqual(HORARIO);
  });

  it("volver conserva los valores", () => {
    const e = aplicar(
      conCotizacion,
      { tipo: "ir_a", paso: 4 },
      { tipo: "cambiar_direccion", direccion: { ...conCotizacion.direccion, calle: "Jr. Junín" } },
      { tipo: "atras" },
      { tipo: "atras" },
    );
    expect(e.paso).toBe(2);
    expect(e.direccion.calle).toBe("Jr. Junín");
    expect(e.horario).toEqual(HORARIO);
    expect(e.cotizacion).not.toBeNull();
  });

  it("no baja del paso 1 ni vuelve atrás desde la confirmación", () => {
    expect(reductor(inicial, { tipo: "atras" }).paso).toBe(1);
    const listo = reductor(conCotizacion, { tipo: "reserva_creada", respuesta: RESPUESTA_201 });
    expect(listo.paso).toBe(6);
    expect(reductor(listo, { tipo: "atras" }).paso).toBe(6);
    expect(reductor(listo, { tipo: "ir_a", paso: 3 }).paso).toBe(6);
  });

  it("siguiente no avanza si la regla no se cumple", () => {
    expect(reductor(inicial, { tipo: "siguiente" }).paso).toBe(1);
    expect(reductor(aplicar(inicial, { tipo: "elegir_servicio", servicio: "estandar" }), { tipo: "siguiente" }).paso).toBe(2);
  });

  it("un 409 de cupo vuelve al paso de fecha y conserva servicio, dirección y comprobante", () => {
    const e = aplicar(
      conCotizacion,
      { tipo: "ir_a", paso: 5 },
      { tipo: "cambiar_direccion", direccion: { distrito: "Barranco", calle: "Jr. Junín", numero: "45", departamento: "", referencias: "" } },
      { tipo: "elegir_metodo", metodo: "yape" },
      { tipo: "comprobante_subido", ruta: "comprobantes/u1/1.webp" },
      { tipo: "sin_cupo", mensaje: "Esa hora ya no está libre.", comprobante: "comprobantes/u1/1.webp" },
    );
    expect(e.paso).toBe(3);
    expect(e.horario).toBeNull();
    expect(e.mensaje).toBe("Esa hora ya no está libre.");
    expect(e.comprobante).toBe("comprobantes/u1/1.webp");
    expect(e.direccion.calle).toBe("Jr. Junín");
    expect(e.tipo).toBe("profunda");
    expect(e.cotizacion).not.toBeNull();
    expect(e.bloqueado).toBe(false);
  });

  it("un 409 de pago en revisión marca el bloqueo y deja el paso", () => {
    const e = aplicar(conCotizacion, { tipo: "ir_a", paso: 5 }, { tipo: "bloqueado", mensaje: "Ya tienes un pago en revisión." });
    expect(e).toMatchObject({ paso: 5, bloqueado: true, mensaje: "Ya tienes un pago en revisión." });
  });

  it("un error de envío muestra el mensaje y deja todo como estaba", () => {
    const e = reductor({ ...conCotizacion, paso: 5 }, { tipo: "error_de_envio", mensaje: "Revisa el número." });
    expect(e).toMatchObject({ paso: 5, mensaje: "Revisa el número.", bloqueado: false });
  });
});

describe("puedeAvanzar", () => {
  const base = aplicar(inicial, { tipo: "elegir_servicio", servicio: "profunda" }, { tipo: "cotizacion_lista", cotizacion: PROFUNDA_2_1() });

  it("paso 1: necesita un servicio", () => {
    expect(puedeAvanzar(1, inicial)).toBe(false);
    expect(puedeAvanzar(1, base)).toBe(true);
  });

  it("paso 2: necesita tamaño válido y cotización", () => {
    expect(puedeAvanzar(2, base)).toBe(true);
    expect(puedeAvanzar(2, { ...base, cotizacion: null })).toBe(false);
    expect(puedeAvanzar(2, { ...base, banos: 0 })).toBe(false);
    const paquete = aplicar(inicial, { tipo: "elegir_servicio", servicio: "paquete" });
    expect(puedeAvanzar(2, paquete)).toBe(false);
    expect(puedeAvanzar(2, { ...paquete, horasPaquete: 6, cotizacion: PROFUNDA_2_1() })).toBe(true);
  });

  it("paso 3: necesita día y un horario antes del límite", () => {
    expect(puedeAvanzar(3, base)).toBe(false);
    const conDia = aplicar(base, { tipo: "elegir_dia", dia: "2026-11-09" });
    expect(puedeAvanzar(3, conDia)).toBe(false);
    expect(puedeAvanzar(3, reductor(conDia, { tipo: "elegir_horario", horario: HORARIO }))).toBe(true);
    const tarde = { hora: "09:00", inicio: "2027-02-02T17:00:00-05:00" };
    expect(puedeAvanzar(3, reductor(conDia, { tipo: "elegir_horario", horario: tarde }))).toBe(false);
  });

  it("paso 4: distrito, calle y número; departamento y referencias son opcionales", () => {
    const dir = { distrito: "Barranco", calle: "Jr. Junín", numero: "45", departamento: "", referencias: "" };
    expect(puedeAvanzar(4, base)).toBe(false);
    expect(puedeAvanzar(4, { ...base, direccion: dir })).toBe(true);
    expect(puedeAvanzar(4, { ...base, direccion: { ...dir, numero: "  " } })).toBe(false);
    expect(puedeAvanzar(4, { ...base, direccion: { ...dir, distrito: "" } })).toBe(false);
  });

  it("paso 5: necesita método y comprobante", () => {
    expect(puedeAvanzar(5, base)).toBe(false);
    expect(puedeAvanzar(5, { ...base, metodo: "yape" })).toBe(false);
    expect(puedeAvanzar(5, { ...base, metodo: "yape", comprobante: "c/1.jpg" })).toBe(true);
  });

  it("paso 6: no hay siguiente", () => {
    expect(puedeAvanzar(6, base)).toBe(false);
  });
});

describe("modo miembro: limpieza sin costo", () => {
  const conCotizacion = (cotizacion: Estado["cotizacion"]) =>
    aplicar(
      inicial,
      { tipo: "elegir_servicio", servicio: "estandar" },
      { tipo: "cotizacion_lista", cotizacion: cotizacion as NonNullable<Estado["cotizacion"]> },
      { tipo: "elegir_horario", horario: HORARIO },
    );

  it("con total_a_pagar 0, el paso de pago avanza sin método ni comprobante", () => {
    const e = conCotizacion(MIEMBRO_SIN_COSTO());
    expect(e.metodo).toBeNull();
    expect(e.comprobante).toBeNull();
    expect(sinCosto(e)).toBe(true);
    expect(puedeAvanzar(5, e)).toBe(true);
  });

  it("con monto mayor que 0 sigue exigiendo método y comprobante", () => {
    const e = conCotizacion(MIEMBRO_ESTANDAR_2_1());
    expect(sinCosto(e)).toBe(false);
    expect(puedeAvanzar(5, e)).toBe(false);
    expect(puedeAvanzar(5, aplicar(e, { tipo: "elegir_metodo", metodo: "yape" }, { tipo: "comprobante_subido", ruta: "c/1.jpg" }))).toBe(true);
  });

  it("la primera membresía nunca es sin costo (incluye la membresía en el total)", () => {
    expect(sinCosto(conCotizacion(PROFUNDA_2_1()))).toBe(false);
  });

  it("sin cotización no es sin costo", () => {
    expect(sinCosto(inicial)).toBe(false);
  });

  it("un bloqueo por pago aprobado conserva el enlace a la cuenta", () => {
    const e = reductor(inicial, { tipo: "bloqueado", mensaje: "Tienes un pago aprobado esperando horario.", enlace: "/cuenta" });
    expect(e).toMatchObject({ bloqueado: true, enlaceBloqueo: "/cuenta" });
    expect(reductor(inicial, { tipo: "bloqueado", mensaje: "x" }).enlaceBloqueo).toBeNull();
  });

  it("recotizar invalida la cotización con dirección y el comprobante, y deja el mensaje", () => {
    const e = aplicar(conCotizacion(MIEMBRO_SIN_COSTO()), { tipo: "cotizacion_con_direccion", cotizacion: MIEMBRO_SIN_COSTO(), clave: "k" }, { tipo: "recotizar", mensaje: "Sube el comprobante" });
    expect(e).toMatchObject({ direccionCotizada: null, comprobante: null, mensaje: "Sube el comprobante" });
  });
});
