import { describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { ErrorApi } from "../errores";
import type { Usuario } from "../sesion";
import { crearTxDoble, render, type Guion } from "./__dobles__/tx-doble";
import { MENSAJE_PLAZO_VENCIDO, reenviarComprobante, type DependenciasReenvio } from "./reenvio";

const USUARIO: Usuario = { id: "u1", correo: "u1@tiza.test", nombre: "María", celular: "987654321", rol: "cliente" };
const PAGO_ID = "11111111-1111-4111-8111-111111111111";
const NUEVO_ID = "44444444-4444-4444-8444-444444444444";
const MEMBRESIA_ID = "22222222-2222-4222-8222-222222222222";
const RUTA_SUBIDA = "comprobantes/u1/otro.jpg";
const RUTA_VERIFICADA = "comprobantes/u1/verificada.jpg";

const rechazado = (extra: Record<string, unknown> = {}) => ({
  id: PAGO_ID,
  usuarioId: "u1",
  concepto: "membresia_y_reserva",
  membresiaId: MEMBRESIA_ID,
  monto: 33666,
  metodo: "yape",
  comprobanteRuta: "comprobantes/u1/primero.jpg",
  estado: "rechazado",
  revisadoPor: "admin-1",
  revisadoEn: new Date("2026-11-02T15:00:00Z"),
  ...extra,
});
const nuevo = (extra: Record<string, unknown> = {}) => ({
  id: NUEVO_ID,
  usuarioId: "u1",
  concepto: "membresia_y_reserva",
  membresiaId: MEMBRESIA_ID,
  monto: 33666,
  metodo: "transferencia",
  comprobanteRuta: RUTA_VERIFICADA,
  estado: "pendiente",
  reemplazaA: PAGO_ID,
  ...extra,
});
const reserva = { id: "r1", estado: "pendiente", expiraEn: new Date("2026-11-03T15:00:00Z") };

// Orden de las sentencias sobre `pagos`: 1) bloqueo del rechazado, 2) plazo, 3) pagos pendientes de la membresía, 4) insert.
function guionFeliz(extra: Guion = {}): Guion {
  return {
    pagos: [[rechazado()], [{ vigente: true }], [], [nuevo()]],
    membresias: [[{ estado: "pendiente" }]],
    reservas: [[reserva]],
    ...extra,
  };
}

function montar(guion: Guion, config: Partial<typeof VALORES_DEL_DISENO> = {}, extra: Partial<DependenciasReenvio> = {}) {
  const doble = crearTxDoble(guion);
  const verificarImagen = vi.fn(async () => ({ ruta: RUTA_VERIFICADA, tipo: "image/jpeg" as const, tamano: 1000 }));
  const dependencias: DependenciasReenvio = {
    leerConfig: async () => ({ ...VALORES_DEL_DISENO, ...config }),
    verificarImagen,
    base: () => doble.base,
    ...extra,
  };
  const cuerpo = (c: Record<string, unknown> = {}) => ({ pago_id: PAGO_ID, metodo: "transferencia", comprobante: RUTA_SUBIDA, ...c });
  return {
    ...doble,
    verificarImagen,
    reenviar: (c: unknown = cuerpo()) => reenviarComprobante({ usuario: USUARIO, cuerpo: c }, dependencias),
    cuerpo,
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

describe("reenviarComprobante", () => {
  it("con la reserva vigente: pago nuevo que reemplaza al rechazado y la reserva apunta a él sin cambiar su expira_en", async () => {
    const m = montar(guionFeliz());
    const r = await m.reenviar();
    expect(r.pago).toMatchObject({ id: NUEVO_ID, estado: "pendiente", reemplaza_a: PAGO_ID, monto: 33666, concepto: "membresia_y_reserva" });
    expect(r.reserva).toMatchObject({ id: "r1", estado: "pendiente", expira_en: "2026-11-03T10:00:00-05:00" });
    const [insert, actualiza] = m.escrituras();
    expect(insert).toMatchObject({ tipo: "insert", tabla: "pagos" });
    expect(actualiza).toMatchObject({ tipo: "update", tabla: "reservas" });
    expect(actualiza.set).toHaveProperty("pagoId", NUEVO_ID);
    expect(actualiza.set).not.toHaveProperty("expiraEn"); // no extiende el plazo
    expect(actualiza.donde!.params).toEqual(expect.arrayContaining([PAGO_ID, "pendiente"]));
  });

  it("copia usuario, concepto, membresía y monto del pago rechazado, y guarda la ruta verificada", async () => {
    const m = montar(guionFeliz());
    await m.reenviar();
    const valores = m.escrituras()[0].valores as Record<string, unknown>;
    expect(valores).toMatchObject({
      usuarioId: "u1",
      concepto: "membresia_y_reserva",
      membresiaId: MEMBRESIA_ID,
      monto: 33666,
      metodo: "transferencia",
      comprobanteRuta: RUTA_VERIFICADA,
      estado: "pendiente",
      reemplazaA: PAGO_ID,
    });
    expect(JSON.stringify(valores)).not.toContain(RUTA_SUBIDA);
  });

  it("el monto del cuerpo se ignora", async () => {
    const m = montar(guionFeliz());
    await m.reenviar(m.cuerpo({ monto: 1, concepto: "reserva", membresia_id: "x" }));
    expect(m.escrituras()[0].valores).toMatchObject({ monto: 33666, concepto: "membresia_y_reserva", membresiaId: MEMBRESIA_ID });
  });

  it("con la reserva expirada y dentro del plazo: pago nuevo sin reserva (reserva null)", async () => {
    const m = montar(guionFeliz({ reservas: [[]] }));
    const r = await m.reenviar();
    expect(r.pago.id).toBe(NUEVO_ID);
    expect(r.reserva).toBeNull();
  });

  it("bloquea el pago y la membresía, en ese orden, y empieza marcando las vencidas", async () => {
    const m = montar(guionFeliz());
    await m.reenviar();
    expect(m.bloqueos()).toEqual(["pagos", "membresias"]);
    expect(m.estado.expiraciones).toBe(1);
  });

  it("verifica el comprobante antes de abrir la transacción", async () => {
    const m = montar(guionFeliz());
    await m.reenviar();
    expect(m.verificarImagen).toHaveBeenCalledWith({ ruta: RUTA_SUBIDA, usuario: { id: "u1", rol: "cliente" } });
  });

  describe("plazo", () => {
    it("vencido → 409 plazo_vencido y no se crea nada", async () => {
      const m = montar(guionFeliz({ pagos: [[rechazado()], [{ vigente: false }]] }));
      expect(await error(m.reenviar())).toMatchObject({ status: 409, codigo: "plazo_vencido", message: MENSAJE_PLAZO_VENCIDO });
      expect(m.escrituras()).toEqual([]);
    });

    it.each([7, 2, 30])("el plazo sale de configuración: %i días llegan a la consulta como parámetro", async (dias) => {
      const m = montar(guionFeliz(), { reenvio_comprobante_dias: dias });
      await m.reenviar();
      const consulta = m.sentencias.filter((s) => s.tabla === "pagos" && s.tipo === "select")[1];
      expect(consulta).toBeDefined();
      // El plazo es una expresión SQL con el reloj de la base; los días van como parámetro dentro de la selección.
      const { reenvioVigenteSql } = await import("./plazo");
      const q = render(reenvioVigenteSql(dias))!;
      expect(q.sql).toContain("make_interval(days =>");
      expect(q.sql).toContain("now()");
      expect(q.params).toContain(dias);
    });

    it("membresía caducada → 409 plazo_vencido sin llegar a mirar el plazo", async () => {
      const m = montar(guionFeliz({ membresias: [[{ estado: "caducada" }]] }));
      expect(await error(m.reenviar())).toMatchObject({ status: 409, codigo: "plazo_vencido" });
      expect(m.escrituras()).toEqual([]);
    });
  });

  describe("rechazos", () => {
    it("pago de otro cliente o inexistente → 404 (la consulta filtra por el dueño) y no se crea nada", async () => {
      const m = montar(guionFeliz({ pagos: [[]] }));
      expect(await error(m.reenviar())).toMatchObject({ status: 404 });
      expect(m.sentencias[0].donde!.params).toEqual(expect.arrayContaining([PAGO_ID, "u1"]));
      expect(m.escrituras()).toEqual([]);
    });

    it.each(["pendiente", "aprobado"])("un pago %s → 409 y no se crea nada", async (estado) => {
      const m = montar(guionFeliz({ pagos: [[rechazado({ estado })]] }));
      expect(await error(m.reenviar())).toMatchObject({ status: 409, message: expect.stringMatching(/no está rechazado/) });
      expect(m.escrituras()).toEqual([]);
    });

    it("otro pago pendiente en la membresía → 409", async () => {
      const m = montar(guionFeliz({ pagos: [[rechazado()], [{ vigente: true }], [{ id: "otro" }]] }));
      expect(await error(m.reenviar())).toMatchObject({ status: 409, message: expect.stringMatching(/en revisión/) });
      expect(m.escrituras()).toEqual([]);
    });

    it("un pago_id sin formato de uuid → 404 sin abrir la transacción", async () => {
      const m = montar(guionFeliz());
      expect(await error(m.reenviar(m.cuerpo({ pago_id: "abc" })))).toMatchObject({ status: 404 });
      expect(m.estado.transacciones).toBe(0);
    });

    it("el comprobante no existe o es de otra carpeta → el error de la verificación y la transacción nunca se abre", async () => {
      const m = montar(guionFeliz(), {}, { verificarImagen: async () => { throw ErrorApi.noEncontrado("No encontramos el archivo que subiste. Súbelo de nuevo."); } });
      expect(await error(m.reenviar())).toMatchObject({ status: 404 });
      expect(m.estado.transacciones).toBe(0);
      const otra = montar(guionFeliz(), {}, { verificarImagen: async () => { throw ErrorApi.invalido("La ruta del archivo no es válida."); } });
      expect(await error(otra.reenviar())).toMatchObject({ status: 422 });
      expect(otra.estado.transacciones).toBe(0);
    });

    it.each([
      ["sin método", { metodo: undefined }],
      ["método crédito", { metodo: "credito" }],
      ["sin comprobante", { comprobante: undefined }],
      ["sin pago_id", { pago_id: undefined }],
    ])("%s → 422 sin transacción", async (_nombre, cambios) => {
      const m = montar(guionFeliz());
      expect(await error(m.reenviar(m.cuerpo(cambios)))).toMatchObject({ status: 422 });
      expect(m.estado.transacciones).toBe(0);
    });

    it("un reemplazo simultáneo: el 23505 del índice se traduce a 409 en_espera", async () => {
      const duplicado = Object.assign(new Error("duplicado"), { cause: { code: "23505", constraint: "pagos_un_reemplazo_por_pago" } });
      const doble = crearTxDoble(guionFeliz(), { falloEn: (s) => (s.tipo === "insert" ? duplicado : undefined) });
      const r = reenviarComprobante(
        { usuario: USUARIO, cuerpo: { pago_id: PAGO_ID, metodo: "yape", comprobante: RUTA_SUBIDA } },
        { leerConfig: async () => VALORES_DEL_DISENO, verificarImagen: async () => ({ ruta: RUTA_VERIFICADA, tipo: "image/jpeg", tamano: 1 }), base: () => doble.base },
      );
      expect(await error(r)).toMatchObject({ status: 409, codigo: "en_espera" });
      expect(doble.estado.deshecha).toBe(true);
    });

    it("otro 23505 no se traduce", async () => {
      const original = Object.assign(new Error("duplicado"), { cause: { code: "23505", constraint: "otra" } });
      const doble = crearTxDoble(guionFeliz(), { falloEn: (s) => (s.tipo === "insert" ? original : undefined) });
      const r = reenviarComprobante(
        { usuario: USUARIO, cuerpo: { pago_id: PAGO_ID, metodo: "yape", comprobante: RUTA_SUBIDA } },
        { leerConfig: async () => VALORES_DEL_DISENO, verificarImagen: async () => ({ ruta: RUTA_VERIFICADA, tipo: "image/jpeg", tamano: 1 }), base: () => doble.base },
      );
      expect(await error(r)).toBe(original);
    });
  });
});
