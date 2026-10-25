import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { crearBdDoble, type Guion } from "../perfil/__dobles__/bd-doble";
import type { Usuario } from "../sesion";
import {
  cancelarReservaDelCliente,
  ErrorFueraDePlazo,
  MENSAJE_CANCELADA_POR_TIZA,
  MENSAJE_RESERVA_NO_ENCONTRADA,
  MENSAJE_YA_EXPIRO,
  MENSAJE_YA_REALIZADA,
  type ConfigCancelar,
  type DependenciasCancelar,
} from "./cancelar";

const AHORA = new Date("2026-11-02T15:00:00Z");
const enHoras = (h: number) => new Date(AHORA.getTime() + h * 3_600_000);
const ID = "11111111-1111-4111-8111-111111111111";
const USUARIO: Usuario = { id: "u1", correo: "a@tiza.test", nombre: "Ana", celular: "999111222", rol: "cliente" };

const reserva = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  usuarioId: "u1",
  equipoId: 1,
  pagoId: "pago-1",
  estado: "confirmada",
  canceladaPor: null,
  tipo: "estandar",
  horasTrabajo: "4.0",
  horasGratisAplicadas: "0.0",
  creditoAplicado: "0.0",
  primeraGratis: false,
  distrito: "Miraflores",
  calle: "Av. Larco",
  numero: "123",
  departamento: null,
  direccionNormalizada: "avenida larco 123",
  departamentoNormalizado: "",
  inicio: enHoras(72),
  fin: enHoras(76),
  ...extra,
});

const cancelada = (extra: Record<string, unknown> = {}) => reserva({ ...extra, estado: "cancelada", canceladaPor: "cliente" });

type Armado = { guion: Guion; config?: Partial<ConfigCancelar>; numero?: string | null };
function armar({ guion, config = {}, numero = "51987654321" }: Armado) {
  const doble = crearBdDoble(guion);
  const dependencias: DependenciasCancelar = {
    base: () => doble.base,
    leerConfig: async () => ({ ...VALORES_DEL_DISENO, ...config }),
    numeroWhatsapp: () => numero,
  };
  const cancelar = (id = ID, ahora = AHORA) => cancelarReservaDelCliente({ usuario: USUARIO, reservaId: id, ahora }, dependencias);
  return { doble, cancelar };
}

// Cola de `reservas` para una cancelación válida de una reserva SIN primera_gratis: select FOR UPDATE y UPDATE returning.
const colaSimple = (previa = reserva(), posterior = cancelada(previa)) => [[previa], [posterior]];

describe("cancelarReservaDelCliente: reglas", () => {
  it("cancela una confirmada a 3 días: estado cancelada, cancelada_por cliente, expira_en vacío", async () => {
    const { doble, cancelar } = armar({ guion: { reservas: colaSimple(), pagos: [[{ estado: "aprobado" }]] } });
    const r = await cancelar();
    expect(r.reserva).toMatchObject({ id: ID, estado: "cancelada", cancelada_por: "cliente" });
    const [update] = doble.escrituras();
    expect(update.set).toMatchObject({ estado: "cancelada", canceladaPor: "cliente", expiraEn: null });
    expect(update.donde?.params).toEqual(expect.arrayContaining([ID, "u1"]));
  });

  it("la transacción empieza con expirarVencidas y el SELECT lleva FOR UPDATE y el usuario_id", async () => {
    const { doble, cancelar } = armar({ guion: { reservas: colaSimple(), pagos: [[{ estado: "aprobado" }]] } });
    await cancelar();
    expect(doble.estado.transacciones).toBe(1);
    expect(doble.estado.expiraciones).toBe(1);
    const select = doble.sentencias.find((s) => s.tipo === "select" && s.tabla === "reservas")!;
    expect(select.bloqueo).toBe(true);
    expect(select.donde?.params).toEqual(expect.arrayContaining([ID, "u1"]));
  });

  it("exactamente 24 horas antes: se acepta", async () => {
    const { cancelar } = armar({ guion: { reservas: colaSimple(reserva({ inicio: enHoras(24) })), pagos: [[{ estado: "aprobado" }]] } });
    expect((await cancelar()).reserva.estado).toBe("cancelada");
  });

  it("23 h 59 min antes: 409 fuera_de_plazo con el mensaje y el enlace de WhatsApp, sin escribir", async () => {
    const { doble, cancelar } = armar({ guion: { reservas: [[reserva({ inicio: new Date(enHoras(24).getTime() - 60_000) })]] } });
    const error = await cancelar().catch((e) => e);
    expect(error).toBeInstanceOf(ErrorFueraDePlazo);
    expect(error).toMatchObject({ status: 409, codigo: "fuera_de_plazo", message: "Solo puedes cancelar hasta 24 horas antes del servicio. Si necesitas ayuda, escríbenos por WhatsApp." });
    expect(error.whatsapp).toMatch(/^https:\/\/wa\.me\/51987654321\?text=/);
    expect(decodeURIComponent(error.whatsapp)).toContain("cancelar mi reserva");
    expect(doble.escrituras()).toEqual([]);
  });

  it("sin número de WhatsApp el enlace es null", async () => {
    const { cancelar } = armar({ guion: { reservas: [[reserva({ inicio: enHoras(10) })]] }, numero: null });
    expect((await cancelar().catch((e) => e)).whatsapp).toBeNull();
  });

  it("cancelacion_minima_horas en 12 cambia el resultado (13 h antes se acepta, y 11 h no)", async () => {
    const config = { cancelacion_minima_horas: 12 };
    const ok = armar({ config, guion: { reservas: colaSimple(reserva({ inicio: enHoras(13) })), pagos: [[{ estado: "aprobado" }]] } });
    expect((await ok.cancelar()).reserva.estado).toBe("cancelada");
    const no = armar({ config, guion: { reservas: [[reserva({ inicio: enHoras(11) })]] } });
    const error = await no.cancelar().catch((e) => e);
    expect(error.message).toBe("Solo puedes cancelar hasta 12 horas antes del servicio. Si necesitas ayuda, escríbenos por WhatsApp.");
  });

  it("pendiente vigente: se cancela y el pago no se toca", async () => {
    const previa = reserva({ estado: "pendiente" });
    const { doble, cancelar } = armar({ guion: { reservas: colaSimple(previa), pagos: [[{ estado: "pendiente" }]] } });
    const r = await cancelar();
    expect(r.pago).toEqual({ estado: "pendiente" });
    expect(doble.escrituras().map((s) => s.tabla)).toEqual(["reservas"]);
  });

  it.each([
    ["completada", { estado: "completada" }, MENSAJE_YA_REALIZADA],
    ["expirada", { estado: "expirada" }, MENSAJE_YA_EXPIRO],
    ["cancelada por el administrador", { estado: "cancelada", canceladaPor: "admin" }, MENSAJE_CANCELADA_POR_TIZA],
  ])("%s: 409 con su propio mensaje y sin escribir", async (_n, extra, mensaje) => {
    const { doble, cancelar } = armar({ guion: { reservas: [[reserva(extra)]] } });
    const error = await cancelar().catch((e) => e);
    expect(error).toMatchObject({ status: 409, message: mensaje });
    expect(doble.escrituras()).toEqual([]);
  });

  it("ya cancelada por el cliente: 200 sin escribir (idempotente)", async () => {
    const { doble, cancelar } = armar({ guion: { reservas: [[cancelada()]], pagos: [[{ estado: "aprobado" }]] } });
    const r = await cancelar();
    expect(r.reserva).toMatchObject({ estado: "cancelada", cancelada_por: "cliente" });
    expect(doble.escrituras()).toEqual([]);
  });

  it("reserva de otro cliente o inexistente: 404 y sin escribir", async () => {
    const { doble, cancelar } = armar({ guion: { reservas: [[]] } });
    const error = await cancelar().catch((e) => e);
    expect(error).toMatchObject({ status: 404, message: MENSAJE_RESERVA_NO_ENCONTRADA });
    expect(doble.escrituras()).toEqual([]);
  });

  it("id sin formato de uuid: 404 sin abrir transacción", async () => {
    const { doble, cancelar } = armar({ guion: {} });
    const error = await cancelar("abc").catch((e) => e);
    expect(error.status).toBe(404);
    expect(doble.estado.transacciones).toBe(0);
  });
});

describe("cancelarReservaDelCliente: respuesta (limpieza gratis y horas pagadas)", () => {
  const primera = (extra: Record<string, unknown> = {}) => reserva({ primeraGratis: true, horasTrabajo: "3.0", horasGratisAplicadas: "3.0", ...extra });

  it("primera de 3 h: 0 horas pagadas y limpieza gratis conservada", async () => {
    const previa = primera();
    const { cancelar } = armar({ guion: { reservas: [[previa], [cancelada(previa)], [], []], pagos: [[{ estado: "pendiente" }]] } });
    const r = await cancelar();
    expect(r.horas_pagadas).toBe(0);
    expect(r.limpieza_gratis_conservada).toBe(true);
  });

  it("primera de 5 h con pago aprobado: 2 horas pagadas", async () => {
    const previa = primera({ horasTrabajo: "5.0" });
    const { cancelar } = armar({ guion: { reservas: [[previa], [cancelada(previa)], [], []], pagos: [[{ estado: "aprobado" }]] } });
    const r = await cancelar();
    expect(r.horas_pagadas).toBe(2);
    expect(r.pago).toEqual({ estado: "aprobado" });
  });

  it("limpieza pagada de 4 h aprobada: 4 horas pagadas y sin limpieza gratis que conservar", async () => {
    const { cancelar } = armar({ guion: { reservas: colaSimple(), pagos: [[{ estado: "aprobado" }]] } });
    const r = await cancelar();
    expect(r.horas_pagadas).toBe(4);
    expect(r.limpieza_gratis_conservada).toBe(false);
  });

  it("el crédito aplicado no cuenta como horas pagadas en dinero", async () => {
    const { cancelar } = armar({ guion: { reservas: colaSimple(reserva({ creditoAplicado: "1.5" })), pagos: [[{ estado: "aprobado" }]] } });
    expect((await cancelar()).horas_pagadas).toBe(2.5);
  });

  it("pago pendiente y pago rechazado se reportan tal cual", async () => {
    for (const estado of ["pendiente", "rechazado"]) {
      const { cancelar } = armar({ guion: { reservas: colaSimple(), pagos: [[{ estado }]] } });
      expect((await cancelar()).pago).toEqual({ estado });
    }
  });

  it("con una reserva completada del cliente: no se conserva", async () => {
    const previa = primera();
    // decidirPorCliente encuentra una fila (la completada) y decide falso.
    const { cancelar } = armar({ guion: { reservas: [[previa], [cancelada(previa)], [{ id: "otra" }], []], pagos: [[{ estado: "aprobado" }]] } });
    expect((await cancelar()).limpieza_gratis_conservada).toBe(false);
  });

  it("si otra cuenta recibió la limpieza gratis del hogar: no se conserva", async () => {
    const previa = primera();
    const { cancelar } = armar({ guion: { reservas: [[previa], [cancelada(previa)], [], [{ id: "ajena" }]], pagos: [[{ estado: "aprobado" }]] } });
    expect((await cancelar()).limpieza_gratis_conservada).toBe(false);
  });

  it("decide con la clave del hogar de la reserva cancelada", async () => {
    const previa = primera();
    const { doble, cancelar } = armar({ guion: { reservas: [[previa], [cancelada(previa)], [], []], pagos: [[{ estado: "aprobado" }]] } });
    await cancelar();
    const porHogar = doble.lecturas().filter((s) => s.tabla === "reservas").at(-1)!;
    expect(porHogar.donde?.params).toEqual(expect.arrayContaining(["Miraflores", "avenida larco 123"]));
  });
});


describe("cancelarReservaDelCliente: crédito en horas (ítem 14)", () => {
  const VENCE = new Date("2027-02-02T15:00:00Z");
  const lote = (horas: string) => ({ id: "nuevo", horas_iniciales: horas, vence_en: VENCE });

  it("guarda cancelada_en en el mismo UPDATE del estado (una sola actualización) y genera el lote con el vencimiento en hora de Lima", async () => {
    const { doble, cancelar } = armar({ guion: { reservas: colaSimple(), pagos: [[{ estado: "aprobado" }]], creditos: [[], [lote("4.0")]] } });
    const r = await cancelar();
    const actualizaciones = doble.escrituras().filter((x) => x.tabla === "reservas");
    expect(actualizaciones).toHaveLength(1);
    expect(Object.keys(actualizaciones[0].set ?? {})).toContain("canceladaEn");
    expect(doble.ejecuciones().some((x) => x.texto?.startsWith('UPDATE "reservas"'))).toBe(false);
    const [bloquea, genera] = doble.ejecuciones();
    expect(bloquea.texto).toContain("FOR UPDATE");
    expect(genera.texto).toContain('INSERT INTO "creditos_horas"');
    expect(r.credito).toEqual({ generado_horas: 4, vence_en: "2027-02-02T10:00:00-05:00", devuelto_horas: 0 });
  });

  it("los meses de vencimiento salen de la configuración", async () => {
    for (const meses of [2, 3]) {
      const { doble, cancelar } = armar({ config: { credito_vence_meses: meses }, guion: { reservas: colaSimple(), pagos: [[{ estado: "aprobado" }]], creditos: [[], [lote("4.0")]] } });
      await cancelar();
      expect(doble.ejecuciones().at(-1)!.params).toContain(meses);
    }
  });

  it("pago pendiente: la sentencia no crea lote y no hay crédito generado", async () => {
    const { cancelar } = armar({ guion: { reservas: colaSimple(), pagos: [[{ estado: "pendiente" }]], creditos: [[], []] } });
    const r = await cancelar();
    expect(r.credito).toEqual({ generado_horas: 0, vence_en: null, devuelto_horas: 0 });
    expect(r.pago).toEqual({ estado: "pendiente" });
  });

  it("pagada en parte con crédito: devuelve las horas al lote original y genera solo lo pagado en dinero", async () => {
    const previa = reserva({ creditoAplicado: "1.5" });
    const { doble, cancelar } = armar({
      guion: { reservas: colaSimple(previa), pagos: [[{ estado: "aprobado" }]], creditos: [[{ id: "viejo" }], [{ id: "viejo", horas: "1.5" }], [lote("2.5")]] },
    });
    const r = await cancelar();
    expect(r.credito).toMatchObject({ generado_horas: 2.5, devuelto_horas: 1.5 });
    expect(doble.ejecuciones()[1].params).toEqual([ID, "reservado", "consumido"]);
  });

  it("cubierta por crédito: solo devuelve, no genera", async () => {
    const previa = reserva({ creditoAplicado: "4.0" });
    const { cancelar } = armar({
      guion: { reservas: colaSimple(previa), pagos: [[{ estado: "aprobado" }]], creditos: [[{ id: "viejo" }], [{ id: "viejo", horas: "4" }], []] },
    });
    expect((await cancelar()).credito).toEqual({ generado_horas: 0, vence_en: null, devuelto_horas: 4 });
  });

  it("primera de 5 h con 3 gratis: genera 2 horas; primera de 3 h: nada", async () => {
    const cinco = reserva({ primeraGratis: true, horasTrabajo: "5.0", horasGratisAplicadas: "3.0" });
    const a = armar({ guion: { reservas: [[cinco], [cancelada(cinco)], [], []], pagos: [[{ estado: "aprobado" }]], creditos: [[], [lote("2.0")]] } });
    expect((await a.cancelar()).credito.generado_horas).toBe(2);
    const tres = reserva({ primeraGratis: true, horasTrabajo: "3.0", horasGratisAplicadas: "3.0" });
    const b = armar({ guion: { reservas: [[tres], [cancelada(tres)], [], []], pagos: [[{ estado: "aprobado" }]], creditos: [[], []] } });
    expect((await b.cancelar()).credito.generado_horas).toBe(0);
  });

  it("segunda cancelación (ya cancelada por el cliente): no ejecuta nada de crédito", async () => {
    const { doble, cancelar } = armar({ guion: { reservas: [[cancelada()]], pagos: [[{ estado: "aprobado" }]] } });
    const r = await cancelar();
    expect(doble.ejecuciones()).toEqual([]);
    expect(r.credito).toEqual({ generado_horas: 0, vence_en: null, devuelto_horas: 0 });
  });

  it("fuera de plazo no toca el crédito", async () => {
    const { doble, cancelar } = armar({ guion: { reservas: [[reserva({ inicio: enHoras(10) })]] } });
    await cancelar().catch(() => undefined);
    expect(doble.ejecuciones()).toEqual([]);
  });

  it("no actualiza pagos ni membresias", () => {
    const fuente = readFileSync(new URL("./cancelar.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(fuente).not.toMatch(/update\((pagos|membresias)\)/);
  });
});
