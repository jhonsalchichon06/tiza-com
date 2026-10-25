import { describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { ErrorApi } from "../errores";
import { crearTxDoble, type Guion } from "../pagos/__dobles__/tx-doble";
import type { Usuario } from "../sesion";
import { planDeRenovacion } from "./plan";
import { mensajeMembresiaVigente, MENSAJE_RENOVACION_EN_REVISION, MENSAJE_RENOVACION_SIN_MEMBRESIA, renovarMembresia, type DependenciasRenovar } from "./renovar";

const USUARIO: Usuario = { id: "u1", correo: "u1@tiza.test", nombre: "María", celular: "987654321", rol: "cliente" };
const RUTA_SUBIDA = "comprobantes/u1/renovacion.jpg";
const RUTA_VERIFICADA = "comprobantes/u1/verificada.jpg";
const FIN_VIEJO = new Date("2026-12-01T15:00:00Z");

const vencida = (extra: Record<string, unknown> = {}) => ({ id: "m-vieja", estado: "activa", fin: FIN_VIEJO, vigente: false, ...extra });
const nuevaMembresia = (monto = 26700) => ({ id: "m-nueva", usuarioId: "u1", estado: "pendiente", monto });
const nuevoPago = (monto = 26700, extra: Record<string, unknown> = {}) => ({ id: "p-nuevo", usuarioId: "u1", concepto: "membresia", membresiaId: "m-nueva", monto, metodo: "yape", estado: "pendiente", ...extra });

// Orden sobre `membresias`: 1) candidatas del cierre (vacío = nada que cerrar), 2) las del cliente (con bloqueo), 3) insert.
function guionFeliz(extra: Guion = {}): Guion {
  return { membresias: [[], [vencida()], [nuevaMembresia()]], pagos: [[nuevoPago()]], ...extra };
}

function montar(guion: Guion, config: Partial<typeof VALORES_DEL_DISENO> = {}, extra: Partial<DependenciasRenovar> = {}) {
  const doble = crearTxDoble(guion);
  const verificarImagen = vi.fn(async () => ({ ruta: RUTA_VERIFICADA, tipo: "image/jpeg" as const, tamano: 1000 }));
  const dependencias: Partial<DependenciasRenovar> = { leerConfig: async () => ({ ...VALORES_DEL_DISENO, ...config }), verificarImagen, base: () => doble.base, plan: planDeRenovacion, ...extra };
  const cuerpo = (c: Record<string, unknown> = {}) => ({ metodo: "yape", comprobante: RUTA_SUBIDA, ...c });
  return {
    ...doble,
    verificarImagen,
    cuerpo,
    renovar: (c: unknown = cuerpo()) => renovarMembresia({ usuario: USUARIO, cuerpo: c }, dependencias as DependenciasRenovar),
  };
}

async function error(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("se esperaba un error");
}

describe("renovarMembresia", () => {
  it("con la membresía vencida crea una membresía y un pago pendientes por el plan (3 meses, S/ 267), sin reserva", async () => {
    const t = montar(guionFeliz());
    const r = await t.renovar();
    expect(r).toMatchObject({
      membresia: { id: "m-nueva", estado: "pendiente", monto: 26700 },
      pago: { id: "p-nuevo", concepto: "membresia", monto: 26700, estado: "pendiente" },
      plan: { meses: 3, monto: 26700 },
    });
    const inserciones = t.escrituras().filter((s) => s.tipo === "insert");
    expect(inserciones.map((s) => s.tabla)).toEqual(["membresias", "pagos"]);
    expect(inserciones[0].valores).toMatchObject({ usuarioId: "u1", monto: 26700, estado: "pendiente" });
    expect(inserciones[1].valores).toMatchObject({ usuarioId: "u1", concepto: "membresia", membresiaId: "m-nueva", monto: 26700, metodo: "yape", comprobanteRuta: RUTA_VERIFICADA, estado: "pendiente" });
    // La nueva membresía no lleva fechas: las pone la aprobación del ítem 11.
    expect(inserciones[0].valores).not.toHaveProperty("inicio");
    expect(inserciones[0].valores).not.toHaveProperty("fin");
  });

  it("no escribe en reservas ni toca nada fuera de membresias y pagos (sin limpieza gratis)", async () => {
    const t = montar(guionFeliz());
    await t.renovar();
    expect(new Set(t.sentencias.map((s) => s.tabla))).toEqual(new Set(["membresias", "pagos"]));
    expect(t.escrituras().every((s) => s.tipo === "insert")).toBe(true);
    expect(t.sentencias.some((s) => s.tabla === "reservas")).toBe(false);
  });

  it("bloquea las membresías del cliente para turnar dos renovaciones simultáneas", async () => {
    const t = montar(guionFeliz());
    await t.renovar();
    expect(t.bloqueos()).toContain("membresias");
  });

  it("guarda solo la ruta que devuelve la verificación del comprobante", async () => {
    const t = montar(guionFeliz());
    await t.renovar();
    expect(t.verificarImagen).toHaveBeenCalledWith({ ruta: RUTA_SUBIDA, usuario: { id: "u1", rol: "cliente" } });
    expect(JSON.stringify(t.escrituras())).not.toContain(RUTA_SUBIDA);
  });

  it("el monto sale del plan inyectado (1 mes por S/ 89), no de una constante ni del cliente", async () => {
    const t = montar(guionFeliz({ membresias: [[], [vencida()], [nuevaMembresia(8900)]], pagos: [[nuevoPago(8900)]] }), {}, { plan: () => ({ meses: 1, monto: 8900 }) });
    const r = await t.renovar(t.cuerpo({ monto: 100 }));
    const inserciones = t.escrituras().filter((s) => s.tipo === "insert");
    expect(inserciones[0].valores).toMatchObject({ monto: 8900 });
    expect(inserciones[1].valores).toMatchObject({ monto: 8900 });
    expect(r.plan).toEqual({ meses: 1, monto: 8900 });
  });

  it("con otra configuración (2 meses a S/ 100) el plan por defecto da S/ 200", async () => {
    const t = montar(guionFeliz({ membresias: [[], [vencida()], [nuevaMembresia(20000)]], pagos: [[nuevoPago(20000)]] }), { membresia_precio_mensual: 10000, membresia_meses: 2 });
    await t.renovar();
    expect(t.escrituras().filter((s) => s.tipo === "insert")[1].valores).toMatchObject({ monto: 20000 });
  });

  it("ignora un monto enviado por el cliente", async () => {
    const t = montar(guionFeliz());
    await t.renovar(t.cuerpo({ monto: 100, concepto: "reserva", membresia_id: "otra" }));
    expect(t.escrituras().filter((s) => s.tipo === "insert")[1].valores).toMatchObject({ monto: 26700, concepto: "membresia" });
  });

  it.each([
    ["sin comprobante", { comprobante: undefined }],
    ["comprobante vacío", { comprobante: "" }],
    ["método desconocido", { metodo: "tarjeta" }],
    ["sin método", { metodo: undefined }],
  ])("%s: 422 y no escribe nada", async (_n, cambios) => {
    const t = montar(guionFeliz());
    const e = await error(t.renovar(t.cuerpo(cambios)));
    expect(e.status).toBe(422);
    expect(t.estado.transacciones).toBe(0);
    expect(t.verificarImagen).not.toHaveBeenCalled();
  });

  it("un comprobante ajeno o inexistente: 422 de la verificación y no abre la transacción", async () => {
    const t = montar(guionFeliz(), {}, { verificarImagen: async () => { throw ErrorApi.invalido("No encontramos ese comprobante."); } });
    const e = await error(t.renovar());
    expect(e.status).toBe(422);
    expect(t.estado.transacciones).toBe(0);
  });

  it("todavía vigente: 409 renovacion_no_aplica con la fecha y no escribe nada", async () => {
    const t = montar(guionFeliz({ membresias: [[], [vencida({ fin: new Date("2026-12-20T15:00:00Z"), vigente: true })]] }));
    const e = await error(t.renovar());
    expect(e).toMatchObject({ status: 409, codigo: "renovacion_no_aplica" });
    expect(e.message).toBe(mensajeMembresiaVigente(new Date("2026-12-20T15:00:00Z"), "America/Lima"));
    expect(e.message).toContain("Tu membresía sigue vigente hasta el 20 de diciembre de 2026. Podrás renovarla cuando venza.");
    expect(t.escrituras()).toEqual([]);
  });

  it("sin ninguna membresía: 409 renovacion_no_aplica que lo lleva a reservar su primera limpieza", async () => {
    const t = montar(guionFeliz({ membresias: [[], []] }));
    const e = await error(t.renovar());
    expect(e).toMatchObject({ status: 409, codigo: "renovacion_no_aplica", message: MENSAJE_RENOVACION_SIN_MEMBRESIA });
    expect(t.escrituras()).toEqual([]);
  });

  it("solo una pendiente (primera membresía en revisión): 409 renovacion_no_aplica", async () => {
    const t = montar(guionFeliz({ membresias: [[], [{ id: "m1", estado: "pendiente", fin: null, vigente: false }]] }));
    const e = await error(t.renovar());
    expect(e).toMatchObject({ status: 409, codigo: "renovacion_no_aplica" });
  });

  it("con una renovación en revisión: 409 en_espera y no crea otra", async () => {
    const t = montar(guionFeliz({ membresias: [[], [vencida(), { id: "m-pend", estado: "pendiente", fin: null, vigente: false }]], pagos: [[{ estado: "pendiente", reenvioHasta: null }]] }));
    const e = await error(t.renovar());
    expect(e).toMatchObject({ status: 409, codigo: "en_espera", message: MENSAJE_RENOVACION_EN_REVISION });
    expect(t.escrituras()).toEqual([]);
  });

  it("con la pendiente rechazada dentro del plazo: 409 pago_rechazado con la fecha límite", async () => {
    const t = montar(
      guionFeliz({
        membresias: [[], [vencida(), { id: "m-pend", estado: "pendiente", fin: null, vigente: false }]],
        pagos: [[{ estado: "rechazado", reenvioHasta: "2026-12-09T15:00:00.000Z" }]],
      }),
    );
    const e = await error(t.renovar());
    expect(e).toMatchObject({ status: 409, codigo: "pago_rechazado" });
    expect(e.message).toContain("antes del 9 de diciembre de 2026");
    expect(t.escrituras()).toEqual([]);
  });

  it("plazo vencido: el cierre pasa la pendiente a caducada y se crea una renovación nueva", async () => {
    const t = montar({ membresias: [[{ id: "m-pend" }], [{ id: "m-pend" }], [vencida()], [nuevaMembresia()]], pagos: [[nuevoPago()]] });
    const r = await t.renovar();
    expect(r.membresia.id).toBe("m-nueva");
    const cierre = t.escrituras().find((s) => s.tipo === "update");
    expect(cierre).toMatchObject({ tabla: "membresias", set: { estado: "caducada" } });
    expect(t.escrituras().filter((s) => s.tipo === "insert").map((s) => s.tabla)).toEqual(["membresias", "pagos"]);
  });

  it("dos renovaciones simultáneas: el índice único de la pendiente se traduce a 409 en_espera", async () => {
    const choque = Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("duplicate key"), { code: "23505", constraint: "membresias_una_pendiente_por_cliente" }) });
    const doble = crearTxDoble(guionFeliz(), { falloEn: (s) => (s.tipo === "insert" && s.tabla === "membresias" ? choque : undefined) });
    const e = await error(
      renovarMembresia(
        { usuario: USUARIO, cuerpo: { metodo: "yape", comprobante: RUTA_SUBIDA } },
        { leerConfig: async () => VALORES_DEL_DISENO, verificarImagen: async () => ({ ruta: RUTA_VERIFICADA, tipo: "image/jpeg", tamano: 1 }), base: () => doble.base, plan: (c) => ({ meses: c.membresia_meses, monto: c.membresia_precio_mensual * c.membresia_meses }) },
      ),
    );
    expect(e).toMatchObject({ status: 409, codigo: "en_espera" });
  });
});
