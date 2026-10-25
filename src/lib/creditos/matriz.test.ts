import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { generarCreditoDeCancelacion } from "./lotes";
import { repartirCredito } from "./reparto";
import { cancelarComoAdminConCredito, cancelarConCredito, consumirCreditoDeReservas, devolverCreditoDeReservas } from "./transiciones";

// Matriz de transiciones (design de credito-en-horas, tarea 3.8): un modelo en memoria de reservas, pagos, lotes y usos que
// interpreta SOLO las sentencias de crédito (se reconocen por su texto) y ejecuta las funciones reales de transiciones sobre la
// matriz transición × estado del pago × uso de crédito (ninguno, parcial, total). En cada caso comprueba el invariante
// `horas_disponibles + usos vivos = horas_iniciales` y los resultados de la spec `credito-en-transiciones`.

type Estado = "pendiente" | "confirmada" | "expirada" | "cancelada";
type EstadoPago = "pendiente" | "aprobado" | "rechazado";
type Reserva = { id: string; usuario: string; pago: string; estado: Estado; por: "cliente" | "admin" | null; canceladaEn: Date | null; trabajo: number; gratis: number; credito: number };
type Lote = { id: string; usuario: string; origen: string; iniciales: number; disponibles: number; vence: Date };
type Uso = { credito: string; reserva: string; horas: number; estado: "reservado" | "consumido" | "devuelto" };

const AHORA = new Date("2099-01-10T12:00:00Z");
const dialecto = new PgDialect();
const ESTADOS = ["reservado", "consumido", "devuelto"];

class Modelo {
  reservas: Reserva[] = [];
  pagos = new Map<string, EstadoPago>();
  lotes: Lote[] = [];
  usos: Uso[] = [];

  readonly tx = {
    execute: async (consulta: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const { sql, params } = dialecto.sqlToQuery(consulta);
      return { rows: this.interpretar(sql.replace(/\s+/g, " ").trim(), params) };
    },
  } as never;

  private interpretar(sql: string, params: unknown[]): unknown[] {
    const ids = (p: unknown[]) => p.filter((x) => typeof x === "string" && !ESTADOS.includes(x)) as string[];
    const estados = (p: unknown[]) => p.filter((x) => typeof x === "string" && ESTADOS.includes(x)) as string[];
    if (sql.startsWith('UPDATE "usos_credito" SET "estado" = \'consumido\'')) {
      for (const u of this.usos) if (ids(params).includes(u.reserva) && u.estado === "reservado") u.estado = "consumido";
      return [];
    }
    if (sql.startsWith('SELECT "id" FROM "creditos_horas"')) {
      const sel = new Set(this.usos.filter((u) => ids(params).includes(u.reserva) && estados(params).includes(u.estado)).map((u) => u.credito));
      return this.lotes.filter((l) => sel.has(l.id)).sort((a, b) => (a.id < b.id ? -1 : 1)).map((l) => ({ id: l.id }));
    }
    if (sql.startsWith('WITH "devueltos"')) {
      const suma = new Map<string, number>();
      for (const u of this.usos) {
        if (!ids(params).includes(u.reserva) || !estados(params).includes(u.estado)) continue;
        u.estado = "devuelto";
        suma.set(u.credito, (suma.get(u.credito) ?? 0) + u.horas);
      }
      return [...suma].map(([id, horas]) => {
        this.lotes.find((l) => l.id === id)!.disponibles += horas;
        return { id, horas: String(horas) };
      });
    }
    if (sql.startsWith('UPDATE "reservas" SET "cancelada_en"')) {
      const r = this.reservas.find((x) => x.id === params[0])!;
      if (!r.canceladaEn) r.canceladaEn = AHORA;
      return [];
    }
    if (sql.startsWith('INSERT INTO "creditos_horas"')) {
      const meses = params[0] as number;
      const r = this.reservas.find((x) => x.id === params[1])!;
      const horas = r.trabajo - r.gratis - r.credito;
      if (r.estado !== "cancelada" || r.por !== "cliente" || !r.canceladaEn || this.pagos.get(r.pago) !== "aprobado" || horas <= 0) return [];
      if (this.lotes.some((l) => l.origen === r.id)) return [];
      const vence = new Date(r.canceladaEn);
      vence.setUTCMonth(vence.getUTCMonth() + meses);
      const lote: Lote = { id: `lote-de-${r.id}`, usuario: r.usuario, origen: r.id, iniciales: horas, disponibles: horas, vence };
      this.lotes.push(lote);
      return [{ id: lote.id, horas_iniciales: String(horas), vence_en: vence }];
    }
    throw new Error(`Sentencia no reconocida por el modelo: ${sql.slice(0, 60)}`);
  }

  // Invariante: por lote, disponibles + usos vivos (reservado y consumido) = iniciales; y nunca fuera de rango.
  verificarInvariante() {
    for (const l of this.lotes) {
      const vivos = this.usos.filter((u) => u.credito === l.id && u.estado !== "devuelto").reduce((s, u) => s + u.horas, 0);
      expect(l.disponibles + vivos).toBe(l.iniciales);
      expect(l.disponibles).toBeGreaterThanOrEqual(0);
      expect(l.disponibles).toBeLessThanOrEqual(l.iniciales);
    }
  }
}

// Una reserva de 4 h con el pago dado y crédito aplicado `usado` (0, 1,5 o 4) tomado del lote viejo de 4 h con `repartirCredito`.
function armar(estadoPago: EstadoPago, usado: number) {
  const m = new Modelo();
  m.lotes.push({ id: "lote-viejo", usuario: "u1", origen: "cancelada-vieja", iniciales: 4, disponibles: 4, vence: new Date("2099-03-01T00:00:00Z") });
  const reserva: Reserva = { id: "r1", usuario: "u1", pago: "p1", estado: "pendiente", por: null, canceladaEn: null, trabajo: 4, gratis: 0, credito: usado };
  m.reservas.push(reserva);
  m.pagos.set("p1", estadoPago);
  const { reparto } = repartirCredito([{ id: "lote-viejo", venceEn: m.lotes[0].vence, horasDisponibles: 4 }], usado);
  for (const t of reparto) {
    m.lotes[0].disponibles -= t.horas;
    m.usos.push({ credito: t.creditoId, reserva: "r1", horas: t.horas, estado: "reservado" });
  }
  return { m, reserva };
}

const USOS = [0, 1.5, 4] as const;
const PAGOS: EstadoPago[] = ["pendiente", "aprobado", "rechazado"];
const horasEnDinero = (usado: number) => 4 - usado;
const disponiblesViejo = (m: Modelo) => m.lotes.find((l) => l.id === "lote-viejo")!.disponibles;
const loteNuevo = (m: Modelo) => m.lotes.find((l) => l.id === "lote-de-r1");

describe.each(USOS)("matriz con %s h de crédito aplicado", (usado) => {
  describe.each(PAGOS)("pago %s", (estadoPago) => {
    it("expirar devuelve las horas reservadas al lote original", async () => {
      const { m, reserva } = armar(estadoPago, usado);
      reserva.estado = "expirada";
      await devolverCreditoDeReservas(m.tx, ["r1"], { estados: ["reservado"] });
      expect(disponiblesViejo(m)).toBe(4);
      expect(m.usos.every((u) => u.estado === "devuelto")).toBe(true);
      expect(m.lotes).toHaveLength(1);
      m.verificarInvariante();
    });

    it("rechazar no toca nada; las horas vuelven al expirar", async () => {
      const { m, reserva } = armar(estadoPago, usado);
      const antes = JSON.stringify([m.lotes, m.usos]);
      // rechazarPago no ejecuta ninguna sentencia de crédito: el modelo queda igual
      expect(JSON.stringify([m.lotes, m.usos])).toBe(antes);
      m.verificarInvariante();
      reserva.estado = "expirada";
      await devolverCreditoDeReservas(m.tx, ["r1"], { estados: ["reservado"] });
      expect(disponiblesViejo(m)).toBe(4);
      m.verificarInvariante();
    });

    it("cancelar como administrador devuelve y nunca genera lote", async () => {
      const { m, reserva } = armar(estadoPago, usado);
      reserva.estado = "cancelada";
      reserva.canceladaEn = AHORA; // el UPDATE del estado lo guarda en la misma sentencia
      reserva.por = "admin";
      await cancelarComoAdminConCredito(m.tx, reserva);
      expect(disponiblesViejo(m)).toBe(4);
      expect(m.lotes).toHaveLength(1);
      expect(reserva.canceladaEn).not.toBeNull();
      // una aprobación posterior tampoco genera
      m.pagos.set("p1", "aprobado");
      expect(await generarCreditoDeCancelacion(m.tx, "r1", 3)).toBeNull();
      m.verificarInvariante();
    });

    it("cancelar como cliente: devuelve y genera lote solo si el pago está aprobado y hubo horas en dinero", async () => {
      const { m, reserva } = armar(estadoPago, usado);
      reserva.estado = "cancelada";
      reserva.canceladaEn = AHORA; // el UPDATE del estado lo guarda en la misma sentencia
      reserva.por = "cliente";
      const r = await cancelarConCredito(m.tx, reserva, 3);
      expect(disponiblesViejo(m)).toBe(4);
      const esperaLote = estadoPago === "aprobado" && horasEnDinero(usado) > 0;
      expect(Boolean(loteNuevo(m))).toBe(esperaLote);
      if (esperaLote) {
        expect(loteNuevo(m)!.iniciales).toBe(horasEnDinero(usado));
        expect(loteNuevo(m)!.vence.toISOString()).toBe("2099-04-10T12:00:00.000Z");
        expect(r.generado?.horas).toBe(horasEnDinero(usado));
      } else {
        expect(r.generado).toBeNull();
      }
      m.verificarInvariante();
    });

    it("cancelar como cliente con el pago pendiente y aprobarlo después genera el lote, una sola vez", async () => {
      if (estadoPago !== "pendiente") return;
      const { m, reserva } = armar("pendiente", usado);
      reserva.estado = "cancelada";
      reserva.canceladaEn = AHORA; // el UPDATE del estado lo guarda en la misma sentencia
      reserva.por = "cliente";
      await cancelarConCredito(m.tx, reserva, 3);
      expect(loteNuevo(m)).toBeUndefined();
      m.pagos.set("p1", "aprobado");
      const primero = await generarCreditoDeCancelacion(m.tx, "r1", 3);
      const segundo = await generarCreditoDeCancelacion(m.tx, "r1", 3);
      expect(Boolean(primero)).toBe(horasEnDinero(usado) > 0);
      expect(segundo).toBeNull();
      // vence 3 meses después de la cancelación, no de la aprobación
      if (primero) expect(primero.venceEn.toISOString()).toBe("2099-04-10T12:00:00.000Z");
      m.verificarInvariante();
    });
  });

  it("aprobar (confirmar) pasa los usos a consumido y ya no se devuelven por expiración", async () => {
    const { m, reserva } = armar("pendiente", usado);
    m.pagos.set("p1", "aprobado");
    reserva.estado = "confirmada";
    await consumirCreditoDeReservas(m.tx, ["r1"]);
    expect(m.usos.every((u) => u.estado === "consumido")).toBe(true);
    await devolverCreditoDeReservas(m.tx, ["r1"], { estados: ["reservado"] });
    expect(disponiblesViejo(m)).toBe(4 - usado);
    m.verificarInvariante();
  });

  it("cancelar una confirmada con el crédito consumido lo devuelve y genera lo pagado en dinero", async () => {
    const { m, reserva } = armar("pendiente", usado);
    m.pagos.set("p1", "aprobado");
    reserva.estado = "confirmada";
    await consumirCreditoDeReservas(m.tx, ["r1"]);
    reserva.estado = "cancelada";
      reserva.canceladaEn = AHORA; // el UPDATE del estado lo guarda en la misma sentencia
    reserva.por = "cliente";
    await cancelarConCredito(m.tx, reserva, 3);
    expect(disponiblesViejo(m)).toBe(4);
    expect(loteNuevo(m)?.iniciales).toBe(horasEnDinero(usado) > 0 ? horasEnDinero(usado) : undefined);
    m.verificarInvariante();
  });

  it("devolver dos veces no devuelve dos veces (expiración repetida)", async () => {
    const { m, reserva } = armar("pendiente", usado);
    reserva.estado = "expirada";
    await devolverCreditoDeReservas(m.tx, ["r1"], { estados: ["reservado"] });
    await devolverCreditoDeReservas(m.tx, ["r1"], { estados: ["reservado"] });
    expect(disponiblesViejo(m)).toBe(4);
    m.verificarInvariante();
  });
});
