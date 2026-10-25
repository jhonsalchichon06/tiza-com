import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { ErrorApi } from "../errores";
import { crearBdDoble, type Guion } from "./__dobles__/bd-doble";
import { leerPerfil, type DependenciasPerfil } from "./resumen";
import type { FilaVista } from "./reservas";

const AHORA = new Date("2026-11-02T15:00:00Z");
const enHoras = (h: number) => new Date(AHORA.getTime() + h * 3_600_000);
const CORTE = Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });

const fila = (extra: Partial<FilaVista> = {}): FilaVista => ({
  id: "r1",
  estado: "confirmada",
  tipo: "estandar",
  dormitorios: 2,
  banos: 1,
  horasTrabajo: "4.0",
  requiereApoyo: false,
  distrito: "Miraflores",
  calle: "Av. Larco",
  numero: "123",
  departamento: null,
  referencias: null,
  inicio: enHoras(24 * 5),
  fin: enHoras(24 * 5 + 4),
  precioLista: 12900,
  horasGratisAplicadas: "0.0",
  monto: 11610,
  expiraEn: null,
  vencida: false,
  yaEmpezo: false,
  ...extra,
});

function armar(guion: Guion, extra: Partial<DependenciasPerfil> = {}) {
  const doble = crearBdDoble(guion);
  const orden: string[] = [];
  const dependencias: Partial<DependenciasPerfil> = {
    base: () => doble.base,
    leerConfig: async () => VALORES_DEL_DISENO,
    pasada: async () => {
      orden.push(`pasada@lecturas=${doble.lecturas().length}`);
    },
    rechazadosReenviables: async () => [],
    esperaReintentoMs: 0,
    ...extra,
  };
  return { doble, orden, dependencias };
}

describe("leerPerfil", () => {
  it("devuelve membresia, avisos, proximas e historial; la pasada corre antes de cualquier lectura", async () => {
    const { doble, orden, dependencias } = armar({ membresias: [[]], pagos: [[]], reservas: [[fila()], [fila({ id: "r0", estado: "completada", yaEmpezo: true })]] });
    const r = await leerPerfil({ usuario: { id: "u1" }, ahora: AHORA }, dependencias);
    expect(Object.keys(r).sort()).toEqual(["avisos", "credito", "historial", "membresia", "proximas", "renovacion"]);
    expect(r.membresia).toEqual({ estado: "sin_membresia", plazo_vencido: false });
    expect(r.proximas.map((p) => p.id)).toEqual(["r1"]);
    expect(r.historial.map((p) => p.id)).toEqual(["r0"]);
    expect(orden).toEqual(["pasada@lecturas=0"]);
    for (const l of doble.lecturas().filter((x) => x.tabla !== "pagos" || x.donde)) expect(l.donde?.params).toContain("u1");
  });

  it("un pago rechazado reenviable aparece como aviso con el motivo y el estado pago_rechazado", async () => {
    const { dependencias } = armar(
      {
        membresias: [[{ id: "m1", estado: "pendiente", inicio: null, fin: null, vigente: false, segundosRestantes: null }]],
        pagos: [[{ id: "p1", membresiaId: "m1", estado: "rechazado" }], []],
        reservas: [[], []],
      },
      { rechazadosReenviables: async () => [{ pagoId: "p1", membresiaId: "m1", reenvioHasta: enHoras(96).toISOString(), motivoRechazo: "Borroso" }] },
    );
    const r = await leerPerfil({ usuario: { id: "u1" }, ahora: AHORA }, dependencias);
    expect(r.membresia).toMatchObject({ estado: "pago_rechazado", pago_id: "p1", motivo_rechazo: "Borroso" });
    expect(r.avisos).toMatchObject([{ codigo: "pago_rechazado", pago_id: "p1", motivo: "Borroso", dias_restantes: 4 }]);
  });

  it("una reserva en espera acompaña al aviso del rechazo con su hora límite", async () => {
    const { dependencias } = armar(
      {
        membresias: [[{ id: "m1", estado: "pendiente", inicio: null, fin: null, vigente: false, segundosRestantes: null }]],
        pagos: [[{ id: "p1", membresiaId: "m1", estado: "rechazado" }], []],
        reservas: [[fila({ estado: "pendiente", expiraEn: enHoras(10) })], []],
      },
      { rechazadosReenviables: async () => [{ pagoId: "p1", membresiaId: "m1", reenvioHasta: enHoras(96).toISOString(), motivoRechazo: null }] },
    );
    const r = await leerPerfil({ usuario: { id: "u1" }, ahora: AHORA }, dependencias);
    expect(r.avisos[0].reserva_expira_en).toBe("2026-11-02T20:00:00-05:00");
  });

  it("un corte de conexión seguido de éxito: se reintenta una vez", async () => {
    let llamadas = 0;
    const { dependencias } = armar(
      { membresias: [[]], pagos: [[]], reservas: [[], []] },
      {
        pasada: async () => {
          llamadas++;
          if (llamadas === 1) throw CORTE;
        },
      },
    );
    const r = await leerPerfil({ usuario: { id: "u1" }, ahora: AHORA }, dependencias);
    expect(llamadas).toBe(2);
    expect(r.proximas).toEqual([]);
  });

  it("dos cortes: 503 'Inténtalo en unos segundos.'", async () => {
    const { dependencias } = armar({}, { pasada: async () => { throw CORTE; } });
    const error = await leerPerfil({ usuario: { id: "u1" }, ahora: AHORA }, dependencias).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error).toMatchObject({ status: 503, message: "Inténtalo en unos segundos." });
  });

  it("el error de Drizzle que envuelve el corte también se reintenta", async () => {
    let llamadas = 0;
    const { dependencias } = armar({ membresias: [[]], pagos: [[]], reservas: [[], []] }, {
      leerConfig: async () => {
        llamadas++;
        if (llamadas === 1) throw Object.assign(new Error("Failed query"), { cause: CORTE });
        return VALORES_DEL_DISENO;
      },
    });
    await leerPerfil({ usuario: { id: "u1" }, ahora: AHORA }, dependencias);
    expect(llamadas).toBe(2);
  });
});

describe("leerPerfil: renovación del mes 4", () => {
  const vencida = { id: "m0", estado: "activa", inicio: enHoras(-24 * 95), fin: enHoras(-24 * 5), vigente: false, segundosRestantes: -5 * 86_400 };
  const pendiente = { id: "m1", estado: "pendiente", inicio: null, fin: null, vigente: false, segundosRestantes: null };

  it("membresía vencida sin renovación: bloque vencida con el plan (3 meses, S/ 267) y sin el aviso suelto de «venció»", async () => {
    const { dependencias } = armar({ membresias: [[vencida]], pagos: [[], []], reservas: [[], []] });
    const r = await leerPerfil({ usuario: { id: "u1" }, ahora: AHORA }, dependencias);
    expect(r.membresia.estado).toBe("vencida");
    expect(r.renovacion).toMatchObject({ estado: "vencida", plan: { meses: 3, monto: 26700 } });
    expect(r.avisos.map((a) => a.codigo)).not.toContain("vencida");
  });

  it("renovación en revisión: no se confunde con la primera membresía (sigue vencida, sin el aviso de «tu pago está en revisión»)", async () => {
    const { dependencias } = armar({
      membresias: [[vencida, pendiente]],
      pagos: [[{ id: "p1", membresiaId: "m1", estado: "pendiente" }], []],
      reservas: [[], []],
    });
    const r = await leerPerfil({ usuario: { id: "u1" }, ahora: AHORA }, dependencias);
    expect(r.membresia.estado).toBe("vencida");
    expect(r.renovacion).toMatchObject({ estado: "renovacion_en_revision", pago_id: "p1" });
    expect(r.avisos.map((a) => a.codigo)).not.toContain("en_revision");
    expect(r.avisos.map((a) => a.codigo)).not.toContain("plazo_vencido");
  });

  it("renovación rechazada dentro del plazo: bloque rechazada y el aviso de reenvío con el formulario del ítem 12", async () => {
    const { dependencias } = armar(
      {
        membresias: [[vencida, pendiente]],
        pagos: [[{ id: "p1", membresiaId: "m1", estado: "rechazado" }], []],
        reservas: [[], []],
      },
      { rechazadosReenviables: async () => [{ pagoId: "p1", membresiaId: "m1", reenvioHasta: enHoras(72).toISOString(), motivoRechazo: "Borroso" }] },
    );
    const r = await leerPerfil({ usuario: { id: "u1" }, ahora: AHORA }, dependencias);
    expect(r.renovacion).toMatchObject({ estado: "renovacion_rechazada", pago_id: "p1", motivo_rechazo: "Borroso", dias_restantes: 3 });
    expect(r.avisos).toMatchObject([{ codigo: "pago_rechazado", pago_id: "p1", motivo: "Borroso" }]);
  });

  it("la primera membresía en revisión conserva su estado y su aviso, y la renovación es no_aplica", async () => {
    const { dependencias } = armar({ membresias: [[pendiente]], pagos: [[{ id: "p1", membresiaId: "m1", estado: "pendiente" }], []], reservas: [[], []] });
    const r = await leerPerfil({ usuario: { id: "u1" }, ahora: AHORA }, dependencias);
    expect(r.membresia).toEqual({ estado: "en_revision", pago_id: "p1" });
    expect(r.renovacion).toEqual({ estado: "no_aplica" });
    expect(r.avisos.map((a) => a.codigo)).toEqual(["en_revision"]);
  });

  it("membresía por vencer: la ventana sale de renovacion_aviso_dias (14 días avisa; 7 no)", async () => {
    const activa = { id: "m0", estado: "activa", inicio: enHoras(-24 * 80), fin: enHoras(24 * 10), vigente: true, segundosRestantes: 10 * 86_400 };
    const con14 = armar({ membresias: [[activa]], pagos: [[], []], reservas: [[], []] });
    expect((await leerPerfil({ usuario: { id: "u1" }, ahora: AHORA }, con14.dependencias)).renovacion).toMatchObject({ estado: "por_vencer", dias_restantes: 10 });
    const con7 = armar({ membresias: [[activa]], pagos: [[], []], reservas: [[], []] }, { leerConfig: async () => ({ ...VALORES_DEL_DISENO, renovacion_aviso_dias: 7 }) });
    expect((await leerPerfil({ usuario: { id: "u1" }, ahora: AHORA }, con7.dependencias)).renovacion).toEqual({ estado: "no_aplica" });
  });

  it("todas las lecturas llevan el usuario de la sesión: otro cliente no se mezcla", async () => {
    const { doble, dependencias } = armar({ membresias: [[vencida]], pagos: [[], []], reservas: [[], []] });
    await leerPerfil({ usuario: { id: "u1" }, ahora: AHORA }, dependencias);
    for (const l of doble.lecturas().filter((x) => x.tabla !== "pagos" || x.donde)) expect(l.donde?.params).toContain("u1");
  });
});

describe("leerPerfil: crédito en horas (ítem 14)", () => {
  const vencida = { id: "m0", estado: "activa", inicio: enHoras(-24 * 95), fin: enHoras(-24 * 5), vigente: false, segundosRestantes: -5 * 86_400 };

  it("trae el saldo y el próximo vencimiento del cliente de la sesión", async () => {
    const { doble, dependencias } = armar({ membresias: [[]], pagos: [[]], reservas: [[], []], creditos: [[{ saldo: "2.5", proximo: new Date("2027-02-02T15:00:00Z"), proximo_horas: "1.5" }]] });
    const r = await leerPerfil({ usuario: { id: "u1" }, ahora: AHORA }, dependencias);
    expect(r.credito).toEqual({ saldo_horas: 2.5, proximo_vencimiento: { horas: 1.5, vence_en: "2027-02-02T10:00:00-05:00" }, membresia_vencida: false });
    expect(doble.ejecuciones()).toHaveLength(1);
    expect(doble.ejecuciones()[0].params).toEqual(["u1"]);
  });

  it("sin crédito: saldo 0 y sin vencimiento", async () => {
    const { dependencias } = armar({ membresias: [[]], pagos: [[]], reservas: [[], []] });
    const r = await leerPerfil({ usuario: { id: "u1" }, ahora: AHORA }, dependencias);
    expect(r.credito).toEqual({ saldo_horas: 0, proximo_vencimiento: null, membresia_vencida: false });
  });

  it("con la membresía vencida el saldo se ve y se marca membresia_vencida", async () => {
    const { dependencias } = armar({ membresias: [[vencida]], pagos: [[], []], reservas: [[], []], creditos: [[{ saldo: "4", proximo: new Date("2027-02-02T15:00:00Z"), proximo_horas: "4" }]] });
    const r = await leerPerfil({ usuario: { id: "u1" }, ahora: AHORA }, dependencias);
    expect(r.credito).toMatchObject({ saldo_horas: 4, membresia_vencida: true });
  });
});
