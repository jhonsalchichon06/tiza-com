import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "@/lib/__fixtures__/configuracion";
import { consultarDisponibilidad } from "@/lib/agenda/consulta";
import { instanteLocal } from "@/lib/agenda/horario";
import { leerOcupacion } from "@/lib/agenda/leer";
import { reservas } from "./esquema";
import { PRUEBAS_BD_ACTIVAS, contarRastros, crearBasePruebas, crearEscenario, filaReserva, type BasePruebas, type Dueno } from "./pruebas-bd";

describe.skipIf(!PRUEBAS_BD_ACTIVAS)("lectura de ocupación y disponibilidad (Neon)", () => {
  let ctx: ReturnType<typeof crearBasePruebas>;
  let base: BasePruebas;
  let esc: Awaited<ReturnType<typeof crearEscenario>>;
  let ids: { vigente: string; vencida: string; cancelada: string; expirada: string; confirmada: string };

  const DIA = "2099-06-02"; // martes
  const desde = instanteLocal(DIA, "00:00", "America/Lima");
  const hasta = new Date(desde.getTime() + 30 * 3_600_000);

  beforeAll(async () => {
    ctx = crearBasePruebas();
    base = ctx.base;
    esc = await crearEscenario(base);
    // Cada reserva usa su propio dueño (cliente, membresía y pago): los índices únicos son los reales.
    const duenos: Dueno[] = await esc.crearDuenos(5);
    let siguiente = 0;
    const fila = (equipo: number, hora: string, extra: Partial<Parameters<typeof filaReserva>[0]>) =>
      filaReserva({ ...duenos[siguiente++], equipoId: esc.equipoIds[equipo], inicio: `${DIA}T${hora}:00-05:00`, horasAgenda: 2, ...extra });
    const guardar = async (f: ReturnType<typeof fila>) => (await base.insert(reservas).values(f).returning({ id: reservas.id }))[0].id;
    ids = {
      vigente: await guardar(fila(0, "08:00", { estado: "pendiente", expiraEn: new Date(Date.now() + 3_600_000) })),
      vencida: await guardar(fila(1, "08:00", { estado: "pendiente", expiraEn: new Date(Date.now() - 3_600_000) })),
      cancelada: await guardar(fila(2, "08:00", { estado: "cancelada" })),
      expirada: await guardar(fila(2, "08:00", { estado: "expirada" })),
      confirmada: await guardar(fila(0, "14:00", { estado: "confirmada" })),
    };
  });

  afterAll(async () => {
    await esc?.limpiar();
    if (base) expect(await contarRastros(base)).toBe(0);
    await ctx?.cerrar();
  });

  it("solo cuenta como ocupada la pendiente vigente y la confirmada", async () => {
    const { equipos, ocupadas } = await leerOcupacion(base, { desde, hasta, equipoIds: esc.equipoIds });
    expect(equipos.map((e) => e.id)).toEqual(esc.equipoIds);
    expect(ocupadas.map((o) => `${o.equipoId}:${o.inicio.toISOString()}`).sort()).toEqual(
      [`${esc.equipoIds[0]}:${DIA}T13:00:00.000Z`, `${esc.equipoIds[0]}:${DIA}T19:00:00.000Z`].sort(),
    );
  });

  it("excluirReservaId libera el hueco de la reserva indicada", async () => {
    const { ocupadas } = await leerOcupacion(base, { desde, hasta, equipoIds: esc.equipoIds, excluirReservaId: ids.vigente });
    expect(ocupadas).toHaveLength(1);
  });

  it("sin equipoIds solo cuenta los equipos activos y no ve los de prueba", async () => {
    const { equipos } = await leerOcupacion(base, { desde, hasta });
    expect(equipos.every((e) => !esc.equipoIds.includes(e.id))).toBe(true);
  });

  it("consultarDisponibilidad usa la ocupación real y no filtra datos de nadie", async () => {
    const respuesta = await consultarDisponibilidad(
      { parametros: new URLSearchParams(`fecha=${DIA}&tipo=estandar&dormitorios=0&banos=1`), ahora: new Date("2099-05-01T12:00:00Z") },
      {
        leerConfig: async () => VALORES_DEL_DISENO,
        leerOcupacion: (ventana) => leerOcupacion(base, { ...ventana, equipoIds: esc.equipoIds }),
      },
    );
    expect(respuesta.atendido).toBe(true);
    // Estándar 0/1 = 2 h (+1 h de traslado) y hay 3 equipos de prueba: siempre queda uno libre.
    expect(respuesta.horarios.every((h) => h.disponible)).toBe(true);
    const texto = JSON.stringify(respuesta);
    expect(texto).not.toContain(esc.usuarioId);
    expect(texto).not.toMatch(/Larco|tiza\.test/);
    for (const h of respuesta.horarios) expect(Object.keys(h).sort()).toEqual(["disponible", "hora", "inicio"]);
  });
});
