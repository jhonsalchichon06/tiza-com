import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expirarVencidas, transaccionDeEscritura } from "@/lib/agenda/expirar";
import { leerOcupacion } from "@/lib/agenda/leer";
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

const HACE_UNA_HORA = () => new Date(Date.now() - 3_600_000);
const EN_UNA_HORA = () => new Date(Date.now() + 3_600_000);

describe.skipIf(!PRUEBAS_BD_ACTIVAS)("expiración de reservas vencidas (Neon)", () => {
  let ctx: ReturnType<typeof crearBasePruebas>;
  let base: BasePruebas;
  let esc: Awaited<ReturnType<typeof crearEscenario>>;
  // Cada reserva usa su propio dueño (cliente, membresía y pago): los índices únicos son los reales.
  let duenos: Dueno[];
  let siguiente = 0;

  beforeAll(async () => {
    ctx = crearBasePruebas();
    base = ctx.base;
    esc = await crearEscenario(base);
    duenos = await esc.crearDuenos(24);
  });

  afterAll(async () => {
    await esc?.limpiar();
    if (base) expect(await contarRastros(base)).toBe(0);
    await ctx?.cerrar();
  });

  const fila = (equipo: number, inicio: string, extra: Partial<Parameters<typeof filaReserva>[0]> = {}) =>
    filaReserva({ ...duenos[siguiente++], equipoId: esc.equipoIds[equipo], inicio, horasAgenda: 2, ...extra });
  const estadoDe = async (tx: Pick<BasePruebas, "select">, id: string) =>
    (await tx.select({ estado: reservas.estado }).from(reservas).where(eq(reservas.id, id)))[0]?.estado;

  it("expirarVencidas marca solo la vencida y devuelve su id", async () => {
    await enRollback(base, async (tx) => {
      const [vencida] = await tx.insert(reservas).values(fila(0, "2099-04-06T10:00:00-05:00", { estado: "pendiente", expiraEn: HACE_UNA_HORA() })).returning({ id: reservas.id });
      const [vigente] = await tx.insert(reservas).values(fila(1, "2099-04-06T10:00:00-05:00", { estado: "pendiente", expiraEn: EN_UNA_HORA() })).returning({ id: reservas.id });
      const [confirmada] = await tx.insert(reservas).values(fila(2, "2099-04-06T10:00:00-05:00")).returning({ id: reservas.id });

      expect(await expirarVencidas(tx)).toEqual([vencida.id]);
      expect(await estadoDe(tx, vencida.id)).toBe("expirada");
      expect(await estadoDe(tx, vigente.id)).toBe("pendiente");
      expect(await estadoDe(tx, confirmada.id)).toBe("confirmada");
    });
  });

  it("una vencida sin marcar sigue bloqueando (23P01) y con la marca deja pasar", async () => {
    await enRollback(base, async (tx) => {
      await tx.insert(reservas).values(fila(0, "2099-04-06T10:00:00-05:00", { estado: "pendiente", expiraEn: HACE_UNA_HORA() }));
      expect(await intentarInsertar(tx, fila(0, "2099-04-06T10:00:00-05:00"))).toBe("23P01");
      await expirarVencidas(tx);
      expect(await intentarInsertar(tx, fila(0, "2099-04-06T10:00:00-05:00"))).toBe("ok");
    });
  });

  it("repetirla no cambia nada", async () => {
    await enRollback(base, async (tx) => {
      await tx.insert(reservas).values(fila(0, "2099-04-06T10:00:00-05:00", { estado: "pendiente", expiraEn: HACE_UNA_HORA() }));
      expect(await expirarVencidas(tx)).toHaveLength(1);
      expect(await expirarVencidas(tx)).toEqual([]);
    });
  });

  it("transaccionDeEscritura expira antes de correr la lógica y confirma lo que ella escribe", async () => {
    const [vencida] = await base.insert(reservas).values(fila(0, "2099-04-07T10:00:00-05:00", { estado: "pendiente", expiraEn: HACE_UNA_HORA() })).returning({ id: reservas.id });

    const visto = await transaccionDeEscritura(async (tx) => {
      const estadoAlEmpezar = await estadoDe(tx, vencida.id);
      await tx.insert(reservas).values(fila(0, "2099-04-07T10:00:00-05:00")); // el mismo hueco: solo cabe si ya se marcó
      return estadoAlEmpezar;
    }, base);

    expect(visto).toBe("expirada");
    expect(await estadoDe(base, vencida.id)).toBe("expirada");
  });

  it("la lectura de ocupación no trata la vencida como ocupada y no cambia su estado", async () => {
    const dia = new Date("2099-04-08T05:00:00.000Z");
    const [vencida] = await base.insert(reservas).values(fila(0, "2099-04-08T10:00:00-05:00", { estado: "pendiente", expiraEn: HACE_UNA_HORA() })).returning({ id: reservas.id });

    const { ocupadas } = await leerOcupacion(base, { desde: dia, hasta: new Date(dia.getTime() + 24 * 3_600_000), equipoIds: [esc.equipoIds[0]] });

    expect(ocupadas).toEqual([]);
    expect(await estadoDe(base, vencida.id)).toBe("pendiente"); // solo una escritura la marca
  });
});
