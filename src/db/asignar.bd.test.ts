import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertarEnPrimerEquipoLibre, MENSAJE_SIN_CUPO } from "@/lib/agenda/asignar";
import { transaccionDeEscritura } from "@/lib/agenda/expirar";
import { reservas } from "./esquema";
import {
  PRUEBAS_BD_ACTIVAS,
  contarRastros,
  crearBasePruebas,
  crearEscenario,
  enRollback,
  filaReserva,
  type BasePruebas,
  type Dueno,
} from "./pruebas-bd";

describe.skipIf(!PRUEBAS_BD_ACTIVAS)("inserción en el primer equipo libre (Neon)", () => {
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

  // Se pasa un `equipoId` cualquiera: la función lo reemplaza por cada equipo candidato.
  const fila = (inicio: string, horas = 2) =>
    filaReserva({ ...duenos[siguiente++], equipoId: esc.equipoIds[0], inicio, horasAgenda: horas });
  const sinEquipo = (f: ReturnType<typeof fila>) => {
    const { equipoId: _ignorado, ...resto } = f;
    return resto;
  };
  const dos = () => esc.equipoIds.slice(0, 2);

  it("asigna al primer equipo si está libre y al segundo si el primero está ocupado", async () => {
    await enRollback(base, async (tx) => {
      const a = await insertarEnPrimerEquipoLibre(tx, dos(), sinEquipo(fila("2099-05-04T10:00:00-05:00")));
      const b = await insertarEnPrimerEquipoLibre(tx, dos(), sinEquipo(fila("2099-05-04T10:00:00-05:00")));
      expect(a.equipoId).toBe(esc.equipoIds[0]);
      expect(b.equipoId).toBe(esc.equipoIds[1]);
    });
  });

  it("responde 409 cuando todos están ocupados y la transacción sigue usable", async () => {
    await enRollback(base, async (tx) => {
      await insertarEnPrimerEquipoLibre(tx, dos(), sinEquipo(fila("2099-05-04T10:00:00-05:00")));
      await insertarEnPrimerEquipoLibre(tx, dos(), sinEquipo(fila("2099-05-04T10:00:00-05:00")));
      await expect(insertarEnPrimerEquipoLibre(tx, dos(), sinEquipo(fila("2099-05-04T10:00:00-05:00")))).rejects.toMatchObject({
        status: 409,
        message: MENSAJE_SIN_CUPO,
      });
      // Tras el conflicto la misma transacción puede seguir escribiendo en otra hora.
      const c = await insertarEnPrimerEquipoLibre(tx, dos(), sinEquipo(fila("2099-05-04T16:00:00-05:00")));
      expect(c.equipoId).toBe(esc.equipoIds[0]);
    });
  });

  it("dos transacciones abiertas a la vez por el único cupo: una se guarda y la otra recibe 409", async () => {
    const un = [esc.equipoIds[0]];
    let liberar!: () => void;
    const hastaConfirmar = new Promise<void>((resolver) => (liberar = resolver));
    const pausa = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

    const primera = base.transaction(async (tx) => {
      const r = await insertarEnPrimerEquipoLibre(tx, un, sinEquipo(fila("2099-05-05T10:00:00-05:00")));
      await hastaConfirmar; // sigue abierta mientras la segunda empieza a insertar
      return r;
    });
    await pausa(500);
    const segunda = base.transaction((tx) => insertarEnPrimerEquipoLibre(tx, un, sinEquipo(fila("2099-05-05T10:00:00-05:00"))));
    await pausa(500);
    liberar();

    const [r1, r2] = await Promise.allSettled([primera, segunda]);
    expect(r1.status).toBe("fulfilled");
    expect(r2.status).toBe("rejected");
    expect((r2 as PromiseRejectedResult).reason).toMatchObject({ status: 409 });

    const guardadas = await base.select({ id: reservas.id }).from(reservas).where(inArray(reservas.usuarioId, duenos.map((d) => d.usuarioId)));
    expect(guardadas.filter(Boolean).length).toBeGreaterThanOrEqual(1);
  });

  it("10 peticiones simultáneas por un solo cupo: exactamente 1 gana", async () => {
    const un = [esc.equipoIds[2]];
    const resultados = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        transaccionDeEscritura((tx) => insertarEnPrimerEquipoLibre(tx, un, sinEquipo(fila("2099-05-06T10:00:00-05:00"))), base),
      ),
    );
    const ganadoras = resultados.filter((r) => r.status === "fulfilled");
    const perdedoras = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ganadoras).toHaveLength(1);
    expect(perdedoras).toHaveLength(9);
    for (const p of perdedoras) expect(p.reason).toMatchObject({ status: 409 });

    const enElHueco = await base
      .select({ id: reservas.id })
      .from(reservas)
      .where(eq(reservas.equipoId, esc.equipoIds[2]));
    expect(enElHueco).toHaveLength(1);
  });
});
