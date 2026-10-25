import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { esConflictoDeExclusion } from "@/lib/agenda/errores-bd";
import { reservas } from "./esquema";
import {
  PRUEBAS_BD_ACTIVAS,
  contarRastros,
  crearBasePruebas,
  crearEscenario,
  enRollback,
  filaReserva,
  intentarInsertar,
  type BasePruebas,
  type Dueno,
} from "./pruebas-bd";

// Restricción de exclusión y CHECK de `reservas` contra Neon real. Corre con PRUEBAS_BD=1 y fechas de 2099.
type ExtraFila = Partial<Omit<Parameters<typeof filaReserva>[0], "usuarioId" | "membresiaId" | "pagoId" | "equipoId" | "inicio" | "horasAgenda">>;

describe.skipIf(!PRUEBAS_BD_ACTIVAS)("reservas: restricción de exclusión y CHECK (Neon)", () => {
  let ctx: ReturnType<typeof crearBasePruebas>;
  let base: BasePruebas;
  let esc: Awaited<ReturnType<typeof crearEscenario>>;
  // Cada reserva viva usa su propio dueño (cliente, membresía y pago): los índices únicos son los reales.
  let duenos: Dueno[];
  let siguiente = 0;
  let fila: (equipo: number, inicio: string, horas: number, extra?: ExtraFila) => ReturnType<typeof filaReserva>;

  beforeAll(async () => {
    ctx = crearBasePruebas();
    base = ctx.base;
    esc = await crearEscenario(base);
    duenos = await esc.crearDuenos(12);
    fila = (equipo, inicio, horas, extra = {}) => {
      const d = duenos[siguiente++];
      return filaReserva({ ...d, equipoId: esc.equipoIds[equipo], inicio, horasAgenda: horas, ...extra });
    };
  });

  // Las pruebas se deshacen con ROLLBACK, así que los mismos dueños sirven en cada una.
  beforeEach(() => {
    siguiente = 0;
  });

  afterAll(async () => {
    await esc?.limpiar();
    if (base) expect(await contarRastros(base)).toBe(0);
    await ctx?.cerrar();
  });

  const DIA = "2099-03-02";
  const a = (hora: string) => `${DIA}T${hora}:00-05:00`;

  describe("capacidad por equipo", () => {
    it("dos equipos admiten dos reservas simultáneas y la tercera da 23P01 en ambos", async () => {
      await enRollback(base, async (tx) => {
        expect(await intentarInsertar(tx, fila(0, a("10:00"), 4))).toBe("ok"); // 10:00-14:00, bloqueo hasta 15:00
        expect(await intentarInsertar(tx, fila(1, a("11:00"), 2))).toBe("ok"); // 11:00-13:00, bloqueo hasta 14:00
        expect(await intentarInsertar(tx, fila(0, a("12:00"), 2))).toBe("23P01");
        expect(await intentarInsertar(tx, fila(1, a("12:00"), 2))).toBe("23P01");
      });
    });

    it("empezar justo al terminar el traslado se acepta y un minuto antes se rechaza", async () => {
      await enRollback(base, async (tx) => {
        expect(await intentarInsertar(tx, fila(0, a("10:00"), 2))).toBe("ok"); // bloquea hasta 13:00
        expect(await intentarInsertar(tx, fila(0, `${DIA}T12:59:00-05:00`, 1))).toBe("23P01");
        expect(await intentarInsertar(tx, fila(0, a("13:00"), 1))).toBe("ok");
      });
    });

    it("una pendiente vigente bloquea igual que una confirmada", async () => {
      await enRollback(base, async (tx) => {
        expect(await intentarInsertar(tx, fila(0, a("10:00"), 2, { estado: "pendiente" }))).toBe("ok");
        expect(await intentarInsertar(tx, fila(0, a("10:00"), 2))).toBe("23P01");
      });
    });

    it.each(["cancelada", "expirada", "completada"] as const)("una reserva %s libera el cupo", async (estado) => {
      await enRollback(base, async (tx) => {
        const [primera] = await tx.insert(reservas).values(fila(0, a("10:00"), 2)).returning({ id: reservas.id });
        expect(await intentarInsertar(tx, fila(0, a("10:00"), 2))).toBe("23P01");
        await tx.update(reservas).set({ estado }).where(eq(reservas.id, primera.id));
        expect(await intentarInsertar(tx, fila(0, a("10:00"), 2))).toBe("ok");
      });
    });

    it("una reserva ya cancelada al insertarse no bloquea", async () => {
      await enRollback(base, async (tx) => {
        expect(await intentarInsertar(tx, fila(0, a("10:00"), 2, { estado: "cancelada" }))).toBe("ok");
        expect(await intentarInsertar(tx, fila(0, a("10:00"), 2))).toBe("ok");
      });
    });

    it("el mismo rango en dos equipos distintos no choca", async () => {
      await enRollback(base, async (tx) => {
        expect(await intentarInsertar(tx, fila(0, a("10:00"), 2))).toBe("ok");
        expect(await intentarInsertar(tx, fila(1, a("10:00"), 2))).toBe("ok");
      });
    });
  });

  describe("CHECK", () => {
    const valida = () => fila(0, a("10:00"), 4);

    it.each([
      ["fin igual al inicio", () => ({ ...valida(), fin: valida().inicio })],
      ["fin_bloqueo antes del fin", () => ({ ...valida(), finBloqueo: new Date((valida().fin as Date).getTime() - 1) })],
      ["pendiente sin expira_en", () => fila(0, a("10:00"), 4, { estado: "pendiente", expiraEn: null })],
      ["paquete con dormitorios", () => ({ ...valida(), tipo: "paquete" as const })],
      ["estándar sin dormitorios ni baños", () => ({ ...valida(), dormitorios: null, banos: null })],
      ["requiere apoyo sin estado de apoyo", () => ({ ...valida(), requiereApoyo: true })],
      ["apoyo con estado pero sin requerirlo", () => ({ ...valida(), requiereApoyo: false, apoyoEstado: "por_coordinar" as const })],
    ])("rechaza %s con 23514", async (_nombre, construir) => {
      await enRollback(base, async (tx) => {
        expect(await intentarInsertar(tx, construir())).toBe("23514");
      });
    });

    it("una reserva válida se guarda y sus fechas se leen como instantes", async () => {
      await enRollback(base, async (tx) => {
        const [r] = await tx.insert(reservas).values(valida()).returning();
        expect(r.inicio).toBeInstanceOf(Date);
        expect(r.inicio.toISOString()).toBe("2099-03-02T15:00:00.000Z");
        expect(r.fin.toISOString()).toBe("2099-03-02T19:00:00.000Z");
        expect(r.finBloqueo.toISOString()).toBe("2099-03-02T20:00:00.000Z");
        expect(Number(r.horasAgenda)).toBe(4);
        expect(r.primeraGratis).toBe(false);
      });
    });

    it("un paquete sin dormitorios ni baños y un apoyo coherente son válidos", async () => {
      await enRollback(base, async (tx) => {
        expect(await intentarInsertar(tx, { ...valida(), tipo: "paquete", dormitorios: null, banos: null })).toBe("ok");
        expect(await intentarInsertar(tx, { ...fila(1, a("10:00"), 4), requiereApoyo: true, apoyoEstado: "por_coordinar" })).toBe("ok");
      });
    });
  });

  describe("contrato con Drizzle", () => {
    it("el 23P01 real llega envuelto y esConflictoDeExclusion lo reconoce por error.cause.code", async () => {
      await enRollback(base, async (tx) => {
        await tx.insert(reservas).values(fila(0, a("10:00"), 2));
        let capturado: unknown;
        try {
          await tx.transaction(async (sp) => {
            await sp.insert(reservas).values(fila(0, a("10:00"), 2));
          });
        } catch (error) {
          capturado = error;
        }
        expect(capturado).toBeDefined();
        expect((capturado as { cause?: { code?: string } }).cause?.code).toBe("23P01");
        expect(esConflictoDeExclusion(capturado)).toBe(true);
      });
    });
  });
});
