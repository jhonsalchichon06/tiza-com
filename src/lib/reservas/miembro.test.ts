import { describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { instanteLocal } from "../agenda/horario";
import { ErrorApi } from "../errores";
import type { Usuario } from "../sesion";
import { crearMiembroDoble, type OpcionesMiembro } from "./__dobles__/miembro-doble";
import { MENSAJE_HORARIO_PENDIENTE, crearReservaDeMiembro, type DependenciasMiembro } from "./miembro";

const AHORA = instanteLocal("2026-11-02", "10:00", "America/Lima"); // lunes
const USUARIO: Usuario = { id: "u1", correo: "u1@tiza.test", nombre: "María Pérez", celular: "987654321", rol: "cliente" };
const RUTA_SUBIDA = "comprobantes/u1/recibo-abc.jpg";
const RUTA_VERIFICADA = "comprobantes/u1/verificada-xyz.jpg";
const WHATSAPP_EJEMPLO = "51912345678";
const INICIO = "2026-11-07T10:00:00-05:00"; // sábado, 5 días después
const FIN_MEMBRESIA = instanteLocal("2027-01-20", "10:00", "America/Lima");

const cuerpo = (cambios: Record<string, unknown> = {}) => ({
  servicio: { tipo: "estandar", dormitorios: 2, banos: 1 },
  inicio: INICIO,
  direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: "Dpto. 302" },
  metodo: "yape",
  comprobante: RUTA_SUBIDA,
  ...cambios,
});

// Por defecto: miembro vigente que ya tuvo su limpieza gratis (reservasVivas), así el precio es el de lista con descuento.
function montar(opciones: OpcionesMiembro = {}, extra: Partial<DependenciasMiembro> = {}) {
  const doble = crearMiembroDoble({ membresia: { id: "m1", fin: FIN_MEMBRESIA, vigente: true }, reservasVivas: true, ...opciones }, () => AHORA);
  const verificarImagen = vi.fn(async () => ({ ruta: RUTA_VERIFICADA, tipo: "image/jpeg" as const, tamano: 1000 }));
  const dependencias: DependenciasMiembro = {
    leerConfig: async () => VALORES_DEL_DISENO,
    verificarImagen,
    base: () => doble.base,
    numeroWhatsapp: () => WHATSAPP_EJEMPLO,
    ...extra,
  };
  const crear = (c: unknown = cuerpo(), ahora = AHORA) => crearReservaDeMiembro({ usuario: USUARIO, cuerpo: c, ahora }, dependencias);
  return { ...doble, crear, verificarImagen };
}

async function error(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("se esperaba un error");
}

describe("precio con el descuento de miembro", () => {
  it.each([
    ["estándar 2/1", { tipo: "estandar", dormitorios: 2, banos: 1 }, 12900, 1290, 11610],
    ["profunda 2/1", { tipo: "profunda", dormitorios: 2, banos: 1 }, 19350, 1935, 17415],
    ["paquete de 4 h", { tipo: "paquete", horas: 4 }, 12900, 1290, 11610],
  ])("%s", async (_n, servicio, lista, descuento, monto) => {
    const m = montar();
    await m.crear(cuerpo({ servicio }));
    expect(m.estado.reservas[0]).toMatchObject({ precioLista: lista, descuento, monto, primeraGratis: false, estado: "pendiente" });
    expect(m.estado.pagos[0].monto).toBe(monto);
  });

  it("el descuento sale de la configuración", async () => {
    const m = montar({}, { leerConfig: async () => ({ ...VALORES_DEL_DISENO, descuento_miembro: 0.15 }) });
    await m.crear();
    expect(m.estado.reservas[0]).toMatchObject({ descuento: 1935, monto: 10965 });
  });

  it("ignora los montos del cuerpo", async () => {
    const m = montar();
    await m.crear(cuerpo({ monto: 1, descuento: 99999, horas_gratis: 100 }));
    expect(m.estado.reservas[0]).toMatchObject({ monto: 11610, descuento: 1290 });
    expect(m.estado.pagos[0].monto).toBe(11610);
  });
});

describe("pago, reserva y respuesta", () => {
  it("pago pendiente de concepto reserva sin membresía y reserva pendiente con el plazo de la base", async () => {
    const m = montar();
    const r = await m.crear();
    expect(m.estado.pagos[0]).toMatchObject({
      usuarioId: "u1",
      concepto: "reserva",
      membresiaId: null,
      monto: 11610,
      metodo: "yape",
      comprobanteRuta: RUTA_VERIFICADA,
      estado: "pendiente",
    });
    expect(m.estado.reservas[0]).toMatchObject({ membresiaId: "m1", pagoId: m.estado.pagos[0].id, estado: "pendiente" });
    // La fila recibió una expresión SQL; la respuesta usa el instante que devolvió la base.
    expect(typeof m.estado.reservas[0].expiraEn).toBe("object");
    expect(r.reserva.expira_en).toBe("2026-11-03T10:00:00-05:00");
    expect(r.membresia).toBeNull();
    expect(r.pago).toMatchObject({ concepto: "reserva", monto: 11610, estado: "pendiente" });
    expect(JSON.stringify(m.estado.pagos)).not.toContain(RUTA_SUBIDA);
  });

  it("el mensaje de WhatsApp dice que espera la aprobación del pago", async () => {
    const r = await montar().crear();
    expect(decodeURIComponent(r.whatsapp!.split("?text=")[1])).toContain("en espera de la aprobación de mi pago");
  });

  it("la transacción empieza con expirarVencidas y no inserta una membresía", async () => {
    const m = montar();
    await m.crear();
    expect(m.estado.operaciones[0]).toBe("update:expirar");
    expect(m.estado.operaciones).not.toContain("insert:membresias");
  });

  it("usa el equipo candidato dado o los activos de la base", async () => {
    const propios = montar({}, { equipoIds: [9, 10] });
    await propios.crear();
    expect(propios.estado.intentosDeEquipo).toEqual([9]);
    const base = montar({ equipos: [4, 7] });
    await base.crear();
    expect(base.estado.intentosDeEquipo).toEqual([4]);
  });

  it("sin lotes de crédito no cambia nada", async () => {
    const m = montar();
    await m.crear();
    expect(m.estado.reservas[0]).toMatchObject({ creditoAplicado: "0", monto: 11610 });
    expect(m.estado.usos).toEqual([]);
  });
});

describe("crédito en horas (ítem 14)", () => {
  const ESTANDAR_2_1 = { tipo: "estandar", dormitorios: 2, banos: 1 }; // 4 h, S/ 129
  const PROFUNDA_2_1 = { tipo: "profunda", dormitorios: 2, banos: 1 }; // 5 h
  const lote = (id: string, vence: string, horas: number) => ({ id, venceEn: new Date(vence), horasDisponibles: horas });

  it("cobertura parcial: la reserva queda pendiente, descuenta del lote y deja el uso reservado", async () => {
    const m = montar({ lotes: [lote("a", "2027-01-01T00:00:00Z", 2)] });
    await m.crear();
    expect(m.estado.reservas[0]).toMatchObject({ creditoAplicado: "2", monto: 5805, estado: "pendiente" });
    expect(m.estado.pagos[0]).toMatchObject({ monto: 5805, estado: "pendiente" });
    expect(m.estado.descuentos).toEqual([{ creditoId: "a", horas: 2 }]);
    expect(m.estado.usos).toEqual([{ creditoId: "a", reservaId: m.estado.reservas[0].id, horas: 2, estado: "reservado" }]);
  });

  it("toma primero del lote que vence antes", async () => {
    const m = montar({ lotes: [lote("tarde", "2027-03-01T00:00:00Z", 2), lote("pronto", "2027-01-01T00:00:00Z", 1)] });
    await m.crear();
    expect(m.estado.usos.map((u) => [u.creditoId, u.horas])).toEqual([["pronto", 1], ["tarde", 2]]);
    expect(m.estado.reservas[0]).toMatchObject({ creditoAplicado: "3", monto: 2903 });
  });

  it("bloquea los lotes antes de insertar la reserva y descuenta después", async () => {
    const m = montar({ lotes: [lote("a", "2027-01-01T00:00:00Z", 2)] });
    await m.crear();
    const o = m.estado.operaciones;
    expect(o.indexOf("select:creditos:bloqueo")).toBeLessThan(o.indexOf("insert:reservas"));
    expect(o.indexOf("insert:reservas")).toBeLessThan(o.indexOf("update:creditos"));
  });

  it("crédito que cubre todo: confirmada sin comprobante, pago interno y usos consumido", async () => {
    const m = montar({ lotes: [lote("a", "2027-01-01T00:00:00Z", 4)] });
    const { comprobante: _c, metodo: _m, ...sin } = cuerpo();
    const r = await m.crear(sin);
    expect(m.estado.reservas[0]).toMatchObject({ creditoAplicado: "4", monto: 0, estado: "confirmada", expiraEn: null });
    expect(m.estado.pagos[0]).toMatchObject({ concepto: "reserva", monto: 0, metodo: "credito", estado: "aprobado", comprobanteRuta: null });
    expect(m.estado.usos).toEqual([{ creditoId: "a", reservaId: m.estado.reservas[0].id, horas: 4, estado: "consumido" }]);
    expect(r.reserva).toMatchObject({ estado: "confirmada", monto: 0 });
    expect(m.verificarImagen).not.toHaveBeenCalled();
  });

  it("el comprobante enviado de más se ignora cuando el crédito cubre todo", async () => {
    const m = montar({ lotes: [lote("a", "2027-01-01T00:00:00Z", 6)] });
    await m.crear();
    expect(JSON.stringify(m.estado.pagos)).not.toContain("comprobantes/");
    expect(m.estado.usos).toEqual([expect.objectContaining({ horas: 4, estado: "consumido" })]);
  });

  it("horas gratis primero y crédito después: 5 h con 3 gratis y 2 de crédito quedan cubiertas", async () => {
    const m = montar({ reservasVivas: false, lotes: [lote("a", "2027-01-01T00:00:00Z", 2)] });
    await m.crear(cuerpo({ servicio: PROFUNDA_2_1 }));
    expect(m.estado.reservas[0]).toMatchObject({ horasGratisAplicadas: "3", creditoAplicado: "2", monto: 0, estado: "confirmada" });
    expect(m.estado.usos).toEqual([expect.objectContaining({ horas: 2, estado: "consumido" })]);
  });

  it("si las horas gratis cubren todo no se toca el crédito", async () => {
    const m = montar({ reservasVivas: false, lotes: [lote("a", "2027-01-01T00:00:00Z", 4)] });
    await m.crear(cuerpo({ servicio: { tipo: "estandar", dormitorios: 1, banos: 1 } }));
    expect(m.estado.reservas[0]).toMatchObject({ horasGratisAplicadas: "3", creditoAplicado: "0", monto: 0 });
    expect(m.estado.usos).toEqual([]);
    expect(m.estado.descuentos).toEqual([]);
  });

  it("sin comprobante y con resto por pagar → 422 y los lotes quedan intactos", async () => {
    const m = montar({ lotes: [lote("a", "2027-01-01T00:00:00Z", 1)] });
    const { comprobante: _c, ...sin } = cuerpo();
    expect(await error(m.crear(sin))).toMatchObject({ status: 422, codigo: "comprobante_requerido" });
    expect(m.estado.descuentos).toEqual([]);
    expect(m.estado.usos).toEqual([]);
  });

  it("sin cupo (409) no descuenta nada", async () => {
    const m = montar({ sinCupo: true, lotes: [lote("a", "2027-01-01T00:00:00Z", 4)] });
    expect(await error(m.crear())).toMatchObject({ status: 409 });
    expect(m.estado.descuentos).toEqual([]);
    expect(m.estado.usos).toEqual([]);
  });

  it("membresía vencida: no lee ni toca los lotes", async () => {
    const m = montar({ membresia: null, lotes: [lote("a", "2027-01-01T00:00:00Z", 4)] });
    expect(await error(m.crear())).toMatchObject({ status: 422 });
    expect(m.estado.operaciones).not.toContain("select:creditos:bloqueo");
    expect(m.estado.descuentos).toEqual([]);
  });

  it("con una reserva en espera sigue siendo 409 aunque el crédito cubra todo", async () => {
    const m = montar({ reservaPendiente: true, lotes: [lote("a", "2027-01-01T00:00:00Z", 4)] });
    expect(await error(m.crear())).toMatchObject({ status: 409, codigo: "en_espera" });
    expect(m.estado.reservas).toHaveLength(0);
  });

  it("un fallo del descuento (invariante) deshace la reserva y el pago", async () => {
    const m = montar({ fallaDescuento: true, lotes: [lote("a", "2027-01-01T00:00:00Z", 4)] });
    await expect(m.crear()).rejects.toThrow(/ya no tiene/);
    expect(m.estado.reservas).toHaveLength(0);
    expect(m.estado.pagos).toHaveLength(0);
    expect(m.estado.usos).toEqual([]);
  });
});

describe("comprobante y método", () => {
  it("sin comprobante y con monto mayor que 0 → 422 comprobante_requerido sin escribir nada", async () => {
    const m = montar();
    const { comprobante: _c, ...sin } = cuerpo();
    const e = await error(m.crear(sin));
    expect(e).toMatchObject({ status: 422, codigo: "comprobante_requerido" });
    expect(m.estado.pagos).toHaveLength(0);
    expect(m.estado.reservas).toHaveLength(0);
    expect(m.verificarImagen).not.toHaveBeenCalled();
  });

  it("sin método y con monto mayor que 0 → 422 comprobante_requerido", async () => {
    const m = montar();
    const { metodo: _m, ...sin } = cuerpo();
    expect(await error(m.crear(sin))).toMatchObject({ status: 422, codigo: "comprobante_requerido" });
    expect(m.estado.pagos).toHaveLength(0);
  });

  it("un método que no existe → 422 antes de la transacción", async () => {
    const m = montar();
    expect(await error(m.crear(cuerpo({ metodo: "credito" })))).toMatchObject({ status: 422 });
    expect(m.estado.transacciones).toBe(0);
  });

  it("un comprobante ajeno o inexistente se rechaza antes de abrir la transacción", async () => {
    const ajeno = montar({}, { verificarImagen: async () => { throw ErrorApi.invalido("La ruta no es tuya."); } });
    expect(await error(ajeno.crear())).toMatchObject({ status: 422 });
    expect(ajeno.estado.transacciones).toBe(0);
    const falta = montar({}, { verificarImagen: async () => { throw ErrorApi.noEncontrado("No encontramos el archivo que subiste. Súbelo de nuevo."); } });
    expect(await error(falta.crear())).toMatchObject({ status: 404 });
    expect(falta.estado.transacciones).toBe(0);
  });

  it("verifica con el usuario de la sesión y guarda la ruta verificada", async () => {
    const m = montar();
    await m.crear();
    expect(m.verificarImagen).toHaveBeenCalledWith({ ruta: RUTA_SUBIDA, usuario: { id: "u1", rol: "cliente" } });
  });
});

describe("vigencia de la membresía", () => {
  const conFin = (fin: Date, vigente = true) => montar({ membresia: { id: "m1", fin, vigente } });
  const inicio = instanteLocal("2026-11-07", "10:00", "America/Lima");

  it("30 minutos antes del fin pasa", async () => {
    const m = conFin(new Date(inicio.getTime() + 30 * 60_000));
    await expect(m.crear()).resolves.toBeDefined();
  });

  it("igual al fin → 422 que pide renovar, sin escribir", async () => {
    const m = conFin(inicio);
    const e = await error(m.crear());
    expect(e).toMatchObject({ status: 422, message: expect.stringMatching(/renueva tu membresía/) });
    expect(m.estado.pagos).toHaveLength(0);
    expect(m.estado.reservas).toHaveLength(0);
  });

  it("membresía vencida → 422", async () => {
    const m = conFin(instanteLocal("2026-10-20", "10:00", "America/Lima"), false);
    expect(await error(m.crear())).toMatchObject({ status: 422, message: expect.stringContaining("20 de octubre de 2026") });
  });

  it("sin membresía activa al llegar a la transacción (carrera) → 422", async () => {
    const m = montar({ membresia: null });
    expect(await error(m.crear())).toMatchObject({ status: 422 });
    expect(m.estado.pagos).toHaveLength(0);
  });

  it("se apunta a la membresía que autoriza", async () => {
    const m = montar({ membresia: { id: "la-larga", fin: FIN_MEMBRESIA, vigente: true } });
    await m.crear();
    expect(m.estado.reservas[0].membresiaId).toBe("la-larga");
  });
});

describe("anticipación, horario y capacidad", () => {
  it.each([
    ["menos de 48 horas", "2026-11-04T09:00:00-05:00", /48 horas/],
    ["domingo", "2026-11-08T10:00:00-05:00", /Atendemos de lunes a sábado/],
    ["antes de abrir", "2026-11-07T07:30:00-05:00", /horario de atención/],
    ["pasadas las 6 pm", "2026-11-07T17:30:00-05:00", /terminar antes/],
  ])("%s → 422 sin transacción", async (_n, inicio, mensaje) => {
    const m = montar();
    expect(await error(m.crear(cuerpo({ inicio })))).toMatchObject({ status: 422, message: expect.stringMatching(mensaje) });
    expect(m.estado.transacciones).toBe(0);
  });

  it("sin cupo → 409 conflicto y no queda pago ni reserva", async () => {
    const m = montar({ sinCupo: true });
    const e = await error(m.crear());
    expect(e).toMatchObject({ status: 409, codigo: "conflicto" });
    expect(m.estado.pagos).toHaveLength(0);
    expect(m.estado.reservas).toHaveLength(0);
  });
});

describe("una reserva en espera y un pago esperando horario", () => {
  it("con una reserva pendiente → 409 en_espera", async () => {
    const m = montar({ reservaPendiente: true });
    expect(await error(m.crear())).toMatchObject({ status: 409, codigo: "en_espera", message: "Ya tienes una reserva esperando la aprobación de tu pago." });
    expect(m.estado.pagos).toHaveLength(0);
  });

  it("con un pago aprobado sin horario → 409 horario_pendiente", async () => {
    const m = montar({ pagosSinHorario: [{ id: "pago-viejo" }], ultimasDePagos: [{ pagoId: "pago-viejo", estado: "expirada", canceladaPor: null }] });
    expect(await error(m.crear())).toMatchObject({ status: 409, codigo: "horario_pendiente", message: MENSAJE_HORARIO_PENDIENTE });
    expect(m.estado.pagos).toHaveLength(0);
  });

  it("el pago de una cancelación del cliente no bloquea", async () => {
    const m = montar({ pagosSinHorario: [{ id: "pago-viejo" }], ultimasDePagos: [{ pagoId: "pago-viejo", estado: "cancelada", canceladaPor: "cliente" }] });
    await expect(m.crear()).resolves.toBeDefined();
  });

  it("el pago de una cancelación del administrador sí bloquea", async () => {
    const m = montar({ pagosSinHorario: [{ id: "pago-viejo" }], ultimasDePagos: [{ pagoId: "pago-viejo", estado: "cancelada", canceladaPor: "admin" }] });
    expect(await error(m.crear())).toMatchObject({ status: 409, codigo: "horario_pendiente" });
  });

  it("una reserva confirmada no impide otra (solo cuenta la pendiente)", async () => {
    await expect(montar({ reservasVivas: true }).crear()).resolves.toBeDefined();
  });
});

describe("limpieza gratis conservada y monto 0", () => {
  const PROFUNDA_2_1 = { tipo: "profunda", dormitorios: 2, banos: 1 };
  const ESTANDAR_1_1 = { tipo: "estandar", dormitorios: 1, banos: 1 };

  it("primera cancelada y profunda 2/1 de 5 h → 3 horas gratis, primera_gratis y monto 6966 con comprobante", async () => {
    const m = montar({ reservasVivas: false });
    const r = await m.crear(cuerpo({ servicio: PROFUNDA_2_1 }));
    expect(m.estado.reservas[0]).toMatchObject({ horasGratisAplicadas: "3", primeraGratis: true, monto: 6966, estado: "pendiente" });
    expect(m.estado.pagos[0]).toMatchObject({ monto: 6966, estado: "pendiente", metodo: "yape" });
    expect(r.reserva.horas_gratis_aplicadas).toBe(3);
  });

  it("primera cancelada y estándar 1/1 de 3 h → monto 0: confirmada sin plazo y pago interno aprobado", async () => {
    const m = montar({ reservasVivas: false });
    const r = await m.crear(cuerpo({ servicio: ESTANDAR_1_1 }));
    expect(m.estado.reservas[0]).toMatchObject({ monto: 0, estado: "confirmada", expiraEn: null, primeraGratis: true });
    expect(m.estado.pagos[0]).toMatchObject({ concepto: "reserva", membresiaId: null, monto: 0, metodo: "credito", estado: "aprobado", comprobanteRuta: null });
    expect(m.estado.reservas[0].pagoId).toBe(m.estado.pagos[0].id);
    expect(r.reserva).toMatchObject({ estado: "confirmada", expira_en: null, monto: 0 });
    expect(r.pago).toMatchObject({ metodo: "credito", estado: "aprobado" });
    expect(decodeURIComponent(r.whatsapp!.split("?text=")[1])).toContain("Estado: confirmada.");
  });

  it("el comprobante enviado de más con monto 0 no se guarda", async () => {
    const m = montar({ reservasVivas: false });
    await m.crear(cuerpo({ servicio: ESTANDAR_1_1 }));
    expect(JSON.stringify(m.estado.pagos)).not.toContain("comprobantes/");
  });

  it("monto 0 sin método ni comprobante se acepta", async () => {
    const m = montar({ reservasVivas: false });
    const { metodo: _m, comprobante: _c, ...sin } = cuerpo({ servicio: ESTANDAR_1_1 });
    await expect(m.crear(sin)).resolves.toMatchObject({ reserva: { estado: "confirmada" } });
    expect(m.verificarImagen).not.toHaveBeenCalled();
  });

  it("con una limpieza completada no hay horas gratis", async () => {
    const m = montar({ reservasVivas: true });
    await m.crear(cuerpo({ servicio: PROFUNDA_2_1 }));
    expect(m.estado.reservas[0]).toMatchObject({ horasGratisAplicadas: "0", primeraGratis: false, monto: 17415 });
  });

  it("hogar tomado por otra cuenta → sin horas gratis", async () => {
    const m = montar({ reservasVivas: false, hogarUsado: true });
    await m.crear(cuerpo({ servicio: PROFUNDA_2_1 }));
    expect(m.estado.reservas[0]).toMatchObject({ primeraGratis: false, monto: 17415 });
  });

  it("una carrera que dispara reservas_primera_gratis_por_hogar → 409 limpieza_gratis_usada", async () => {
    const m = montar({
      reservasVivas: false,
      falloAlInsertarReserva: Object.assign(new Error("duplicate"), { cause: { code: "23505", constraint: "reservas_primera_gratis_por_hogar" } }),
    });
    expect(await error(m.crear(cuerpo({ servicio: PROFUNDA_2_1 })))).toMatchObject({ status: 409, codigo: "limpieza_gratis_usada" });
    expect(m.estado.pagos).toHaveLength(0);
  });

  it("con una pendiente previa el monto 0 también da 409 en_espera", async () => {
    const m = montar({ reservasVivas: false, reservaPendiente: true });
    expect(await error(m.crear(cuerpo({ servicio: ESTANDAR_1_1 })))).toMatchObject({ status: 409, codigo: "en_espera" });
    expect(m.estado.pagos).toHaveLength(0);
    expect(m.estado.reservas).toHaveLength(0);
  });

  it("monto 0 sin cupo → 409 conflicto y no queda el pago interno", async () => {
    const m = montar({ reservasVivas: false, sinCupo: true });
    expect(await error(m.crear(cuerpo({ servicio: ESTANDAR_1_1 })))).toMatchObject({ status: 409, codigo: "conflicto" });
    expect(m.estado.pagos).toHaveLength(0);
  });
});
