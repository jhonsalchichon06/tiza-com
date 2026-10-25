import { and, eq, inArray, like, ne } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "@/lib/__fixtures__/configuracion";
import { listarApoyoPorCoordinar, marcarApoyoCoordinado } from "@/lib/admin/reservas/apoyo";
import { completarReserva } from "@/lib/admin/reservas/completar";
import { listarReservas } from "@/lib/admin/reservas/listado";
import { reasignarReserva } from "@/lib/admin/reservas/reasignar";
import { reprogramarReservaPorAdmin, type DependenciasReprogramarAdmin } from "@/lib/admin/reservas/reprogramar";
import { esConflictoDeExclusion } from "@/lib/agenda/errores-bd";
import { instanteLocal } from "@/lib/agenda/horario";
import { ejecutarPasadaDeExpiracion } from "@/lib/agenda/pasada";
import { reprogramarReserva } from "@/lib/reservas/reprogramar";
import type { Usuario } from "@/lib/sesion";
import { equipos, membresias, pagos, reservas, usuarios } from "./esquema";
import { PRUEBAS_BD_ACTIVAS, crearBasePruebas, crearEscenario, enRollback, filaReserva, type BasePruebas, type Dueno } from "./pruebas-bd";

// Gestión de reservas y apoyo contra la rama `pruebas` de Neon (change gestion-de-reservas-y-apoyo): listado con estado
// efectivo, completar, reasignar de equipo (restricción de exclusión), apoyo por coordinar y reprogramar a nombre del
// cliente. Corre con PRUEBAS_BD=1. Equipos de prueba INACTIVOS (por eso `exigirActivo = false`) y fechas de 2099; el reloj de
// los plazos es el de la base. Las reservas «ya iniciadas» están en 2001 para que `inicio <= now()` sea cierto.
const ZONA = "America/Lima";
const CONFIG = VALORES_DEL_DISENO;
const AHORA = instanteLocal("2099-01-05", "10:00", ZONA); // lunes

// Un día distinto para cada escenario (lunes a sábado desde el 2 de febrero de 2099, dentro de los 3 meses de AHORA).
const DIAS: string[] = [];
for (let t = Date.UTC(2099, 1, 2); DIAS.length < 50; t += 86_400_000) {
  if (new Date(t).getUTCDay() !== 0) DIAS.push(new Date(t).toISOString().slice(0, 10));
}
let siguienteDia = 0;
const nuevoDia = () => DIAS[siguienteDia++];
const en = (dia: string, hora: string) => instanteLocal(dia, hora, ZONA).toISOString();
// Días «ya iniciados»: lunes a sábado desde el 7 de enero de 2001.
let iniciados = 0;
const diaIniciado = () => new Date(Date.UTC(2001, 0, 8 + iniciados++ * 7)).toISOString().slice(0, 10);

describe.skipIf(!PRUEBAS_BD_ACTIVAS)("gestión de reservas y apoyo (Neon)", () => {
  let ctx: ReturnType<typeof crearBasePruebas>;
  let base: BasePruebas;
  let esc: Awaited<ReturnType<typeof crearEscenario>>;
  let admin: { id: string };
  let E: number[]; // los 3 equipos de prueba

  beforeAll(async () => {
    ctx = crearBasePruebas();
    base = ctx.base;
    esc = await crearEscenario(base);
    admin = await esc.crearAdmin();
    E = esc.equipoIds;
  });

  afterAll(async () => {
    await esc?.limpiar();
    // Rastros PROPIOS de esta corrida: deben ser 0. El conteo global (`contarRastros`) incluye las corridas de otros que
    // se ejecutan a la vez sobre la misma rama, así que se comprueba aparte cuando nadie más prueba.
    if (base) {
      const mios = await base.select({ id: usuarios.id }).from(usuarios).where(like(usuarios.id, `${esc.usuarioId}%`));
      const equiposMios = await base.select({ id: equipos.id }).from(equipos).where(inArray(equipos.id, E));
      expect(mios.length + equiposMios.length).toBe(0);
    }
    await ctx?.cerrar();
  });

  type Reserva = typeof reservas.$inferSelect;
  type Datos = {
    equipo?: number;
    inicio: string;
    horas?: number;
    estado?: Reserva["estado"];
    expiraEn?: Date | null;
    apoyo?: "por_coordinar" | "coordinado";
    nota?: string;
    dueno?: Dueno;
  };

  // Inserta una reserva de prueba y devuelve su id y su dueño.
  async function poner(d: Datos): Promise<{ id: string; dueno: Dueno }> {
    const dueno = d.dueno ?? (await esc.crearDueno());
    const fila = {
      ...filaReserva({ ...dueno, equipoId: d.equipo ?? E[0], inicio: d.inicio, horasAgenda: d.horas ?? 4, estado: d.estado, expiraEn: d.expiraEn }),
      ...(d.apoyo ? { requiereApoyo: true, apoyoEstado: d.apoyo, apoyoNota: d.nota ?? null } : {}),
    };
    const [r] = await base.insert(reservas).values(fila).returning({ id: reservas.id });
    return { id: r.id, dueno };
  }
  const leer = async (id: string): Promise<Reserva> => (await base.select().from(reservas).where(eq(reservas.id, id)))[0];
  const conBase = { base: () => base };
  const asEstado = (e: Reserva["estado"]) => e;

  // ---------- 8.1 Listado ----------
  describe("listado", () => {
    it("una pendiente con expira_en pasado se lista «expirada» SIN pasada previa, y la pasada la persiste", async () => {
      const dia = nuevoDia();
      const { id } = await poner({ inicio: en(dia, "10:00"), estado: "pendiente", expiraEn: new Date(Date.now() - 3_600_000) });

      const expiradas = await listarReservas(base, { estado: "expirada" }, CONFIG);
      expect(expiradas.reservas.find((r) => r.id === id)?.estado).toBe("expirada");
      const sinFiltro = await listarReservas(base, {}, CONFIG);
      expect(sinFiltro.reservas.some((r) => r.id === id)).toBe(false);
      const pendientes = await listarReservas(base, { estado: "pendiente" }, CONFIG);
      expect(pendientes.reservas.some((r) => r.id === id)).toBe(false);
      expect((await leer(id)).estado).toBe("pendiente"); // nadie la marcó todavía

      await ejecutarPasadaDeExpiracion(base, async () => ({ reenvio_comprobante_dias: CONFIG.reenvio_comprobante_dias }));
      expect((await leer(id)).estado).toBe("expirada");
    });

    it("una pendiente vigente se lista pendiente; el equipo, el cliente y la dirección salen bien", async () => {
      const dia = nuevoDia();
      const { id, dueno } = await poner({ inicio: en(dia, "10:00"), estado: "pendiente", equipo: E[1] });
      const lista = await listarReservas(base, { estado: "pendiente" }, CONFIG);
      const fila = lista.reservas.find((r) => r.id === id)!;
      expect(fila.estado).toBe("pendiente");
      expect(fila.equipo.id).toBe(E[1]);
      expect(fila.cliente.id).toBe(dueno.usuarioId);
      expect(fila.direccion).toMatchObject({ distrito: "Miraflores", calle: "Av. Larco", numero: "123" });
      expect(fila.inicio).toBe(`${dia}T10:00:00-05:00`);
      expect(fila.pago_id).toBe(dueno.pagoId);
      expect(fila.puede_completar).toBe(false);
      expect(fila.puede_reprogramar).toBe(true);
    });

    it("por_completar trae solo las confirmadas ya iniciadas, de la más antigua a la más reciente", async () => {
      const a = await poner({ inicio: en(diaIniciado(), "10:00") });
      const b = await poner({ inicio: en(diaIniciado(), "10:00") });
      const futura = await poner({ inicio: en(nuevoDia(), "10:00") });
      const pendienteIniciada = await poner({ inicio: en(diaIniciado(), "10:00"), estado: "pendiente" });
      const lista = (await listarReservas(base, { estado: "por_completar" }, CONFIG)).reservas;
      const mios = lista.filter((r) => [a.id, b.id, futura.id, pendienteIniciada.id].includes(r.id));
      expect(mios.map((r) => r.id)).toEqual([a.id, b.id]);
      expect(mios.every((r) => r.puede_completar)).toBe(true);
    });
  });

  // ---------- 8.2 Completar ----------
  describe("completar", () => {
    it("confirmada iniciada → completada; el pago y la membresía no cambian", async () => {
      const { id, dueno } = await poner({ inicio: en(diaIniciado(), "10:00") });
      const [pagoAntes] = await base.select().from(pagos).where(eq(pagos.id, dueno.pagoId));
      const [membAntes] = await base.select().from(membresias).where(eq(membresias.id, dueno.membresiaId));

      const r = await completarReserva({ reservaId: id }, conBase);
      expect(r).toEqual({ reserva: { id, estado: "completada" } });
      expect((await leer(id)).estado).toBe("completada");
      const [pagoDespues] = await base.select().from(pagos).where(eq(pagos.id, dueno.pagoId));
      const [membDespues] = await base.select().from(membresias).where(eq(membresias.id, dueno.membresiaId));
      expect(pagoDespues).toEqual(pagoAntes);
      expect(membDespues).toEqual(membAntes);
    });

    it("futura, pendiente, cancelada y expirada → 409 sin cambios", async () => {
      const casos: [string, Datos][] = [
        ["confirmada futura", { inicio: en(nuevoDia(), "10:00") }],
        ["pendiente", { inicio: en(diaIniciado(), "10:00"), estado: "pendiente", expiraEn: new Date(Date.now() + 3_600_000) }],
        ["cancelada", { inicio: en(diaIniciado(), "10:00"), estado: "cancelada" }],
        ["expirada", { inicio: en(diaIniciado(), "10:00"), estado: "expirada" }],
        ["pendiente vencida", { inicio: en(diaIniciado(), "10:00"), estado: "pendiente", expiraEn: new Date(Date.now() - 3_600_000) }],
      ];
      for (const [nombre, datos] of casos) {
        const { id } = await poner(datos);
        const antes = await leer(id);
        await expect(completarReserva({ reservaId: id }, conBase), nombre).rejects.toMatchObject({ status: 409 });
        // Nada cambia. Tampoco la pendiente vencida: la marca `expirada` de la transacción se deshace con el ROLLBACK del 409;
        // por eso existe la pasada de expiración (que sí la persiste), no esta acción.
        expect(await leer(id), nombre).toEqual(antes);
      }
    });

    it("un id inexistente da 404", async () => {
      await expect(completarReserva({ reservaId: "00000000-0000-4000-8000-000000000000" }, conBase)).rejects.toMatchObject({ status: 404 });
    });

    it("dos completar simultáneos → un 200 y un 409", async () => {
      const { id } = await poner({ inicio: en(diaIniciado(), "10:00") });
      const r = await Promise.allSettled([completarReserva({ reservaId: id }, conBase), completarReserva({ reservaId: id }, conBase)]);
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const rechazada = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
      expect(rechazada.reason).toMatchObject({ status: 409 });
      expect((await leer(id)).estado).toBe("completada");
    });

    it("una reserva completada ya no bloquea el cupo del equipo (la restricción solo cubre pendiente y confirmada)", async () => {
      const inicio = en(diaIniciado(), "10:00");
      const { id } = await poner({ inicio, equipo: E[2] });
      await completarReserva({ reservaId: id }, conBase);
      // Otra reserva en el MISMO equipo y horario ahora cabe.
      const otra = await poner({ inicio, equipo: E[2] });
      expect((await leer(otra.id)).estado).toBe("confirmada");
    });
  });

  // ---------- 8.3 Reasignar ----------
  describe("reasignar", () => {
    const reasignar = (reservaId: string, equipo: number) => reasignarReserva({ reservaId, cuerpo: { equipo_id: equipo } }, { ...conBase, exigirActivo: false });

    it("al equipo libre → ok", async () => {
      const { id } = await poner({ inicio: en(nuevoDia(), "10:00"), equipo: E[0] });
      const r = await reasignar(id, E[1]);
      expect(r.reserva).toMatchObject({ id, estado: "confirmada", equipo_id: E[1] });
      expect((await leer(id)).equipoId).toBe(E[1]);
    });

    it("al equipo ocupado → 409 equipo_ocupado y la reserva sigue donde estaba", async () => {
      const dia = nuevoDia();
      const { id } = await poner({ inicio: en(dia, "10:00"), equipo: E[0] });
      await poner({ inicio: en(dia, "12:00"), equipo: E[1] }); // solapa con 10:00-14:00 (+ traslado)
      const antes = await leer(id);
      await expect(reasignar(id, E[1])).rejects.toMatchObject({ status: 409, codigo: "equipo_ocupado", message: "Ese equipo no está libre en ese horario." });
      expect(await leer(id)).toEqual(antes);
    });

    it("justo después del traslado cabe", async () => {
      const dia = nuevoDia();
      // El equipo 1 atiende de 8:00 a 12:00 y su traslado termina a las 13:00; la reserva empieza a las 13:00.
      await poner({ inicio: en(dia, "08:00"), equipo: E[1] });
      const { id } = await poner({ inicio: en(dia, "13:00"), equipo: E[0] });
      expect((await reasignar(id, E[1])).reserva.equipo_id).toBe(E[1]);
      // Un minuto antes (12:30) ya choca con el traslado.
      const { id: choca } = await poner({ inicio: en(dia, "12:30"), equipo: E[2], horas: 1 });
      await expect(reasignar(choca, E[1])).rejects.toMatchObject({ status: 409, codigo: "equipo_ocupado" });
    });

    it("una reserva nueva que gana el hueco entre la lectura y la acción → 409", async () => {
      const dia = nuevoDia();
      const { id } = await poner({ inicio: en(dia, "10:00"), equipo: E[0] });
      // El administrador «lee»: el equipo 1 está libre.
      const antes = await leer(id);
      expect(antes.equipoId).toBe(E[0]);
      // Mientras tanto un cliente toma el hueco del equipo 1.
      await poner({ inicio: en(dia, "10:00"), equipo: E[1] });
      await expect(reasignar(id, E[1])).rejects.toMatchObject({ status: 409, codigo: "equipo_ocupado" });
      expect((await leer(id)).equipoId).toBe(E[0]);
    });

    it("dos reasignaciones por el mismo hueco a la vez → un 200 y un 409, y nunca dos activas solapadas", async () => {
      const dia = nuevoDia();
      const a = await poner({ inicio: en(dia, "10:00"), equipo: E[0] });
      const b = await poner({ inicio: en(dia, "11:00"), equipo: E[2] });
      const r = await Promise.allSettled([reasignar(a.id, E[1]), reasignar(b.id, E[1])]);
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409, codigo: "equipo_ocupado" });
      const enE1 = await base.select().from(reservas).where(and(eq(reservas.equipoId, E[1]), inArray(reservas.id, [a.id, b.id])));
      expect(enE1).toHaveLength(1);
    });

    it("la transacción sigue utilizable tras el 23P01 (savepoint)", async () => {
      const dia = nuevoDia();
      const { id } = await poner({ inicio: en(dia, "10:00"), equipo: E[0] });
      await poner({ inicio: en(dia, "10:00"), equipo: E[1] });
      const resultado = await enRollback(base, async (tx) => {
        let codigo = "ok";
        try {
          await tx.transaction(async (sp) => {
            await sp.update(reservas).set({ equipoId: E[1] }).where(eq(reservas.id, id));
          });
        } catch (error) {
          codigo = esConflictoDeExclusion(error) ? "23P01" : "otro";
        }
        // Si el rechazo hubiera abortado la transacción, esta consulta fallaría con 25P02.
        const [fila] = await tx.select({ equipoId: reservas.equipoId }).from(reservas).where(eq(reservas.id, id));
        return { codigo, equipoId: fila.equipoId };
      });
      expect(resultado).toEqual({ codigo: "23P01", equipoId: E[0] });
    });

    it("una reserva completada, cancelada o expirada no se puede reasignar (409)", async () => {
      for (const estado of ["completada", "cancelada", "expirada"] as const) {
        const { id } = await poner({ inicio: en(diaIniciado(), "10:00"), estado: asEstado(estado) });
        await expect(reasignar(id, E[1]), estado).rejects.toMatchObject({ status: 409 });
      }
    });
  });

  // ---------- 8.4 Apoyo ----------
  describe("apoyo", () => {
    // Días de calendario entre hoy (en Lima) y el día de la reserva, igual que la consulta.
    const diasHasta = (dia: string) => {
      const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date());
      return Math.round((Date.parse(dia) - Date.parse(hoy)) / 86_400_000);
    };

    it("la lista ordena por fecha y excluye coordinado, cancelada, expirada, completada, pendiente vencida y sin apoyo", async () => {
      const [d1, d2, d3] = [nuevoDia(), nuevoDia(), nuevoDia()];
      const jueves = await poner({ inicio: en(d3, "10:00"), apoyo: "por_coordinar", horas: 3.5 });
      const lunes = await poner({ inicio: en(d1, "10:00"), apoyo: "por_coordinar", horas: 3.5 });
      const martes = await poner({ inicio: en(d2, "10:00"), apoyo: "por_coordinar", horas: 3.5, estado: "pendiente" });
      const fuera = [
        await poner({ inicio: en(d1, "15:00"), apoyo: "coordinado", horas: 2 }),
        await poner({ inicio: en(diaIniciado(), "10:00"), apoyo: "por_coordinar", estado: "cancelada" }),
        await poner({ inicio: en(diaIniciado(), "10:00"), apoyo: "por_coordinar", estado: "expirada" }),
        await poner({ inicio: en(diaIniciado(), "10:00"), apoyo: "por_coordinar", estado: "completada" }),
        await poner({ inicio: en(d2, "15:00"), apoyo: "por_coordinar", estado: "pendiente", expiraEn: new Date(Date.now() - 3_600_000), horas: 2 }),
        await poner({ inicio: en(d3, "15:00"), horas: 2 }), // no requiere apoyo
      ];
      const lista = await listarApoyoPorCoordinar(base, CONFIG);
      const ids = [lunes.id, martes.id, jueves.id, ...fuera.map((f) => f.id)];
      const mios = lista.filter((x) => ids.includes(x.id));
      expect(mios.map((x) => x.id)).toEqual([lunes.id, martes.id, jueves.id]);
      expect(mios.map((x) => x.estado)).toEqual(["confirmada", "pendiente", "confirmada"]);
      expect(mios[0].dias_restantes).toBe(diasHasta(d1));
      expect(mios[2].dias_restantes).toBe(diasHasta(d3));
      expect(mios[0]).toMatchObject({ puede_reprogramar: true, cliente: { celular: "900000000" }, horas_agenda: 3.5 });
    });

    it("marcar con nota guarda coordinado y la nota; repetir la reescribe; sin apoyo → 409; el CHECK sigue cumpliéndose", async () => {
      const { id } = await poner({ inicio: en(nuevoDia(), "10:00"), apoyo: "por_coordinar" });
      const r = await marcarApoyoCoordinado({ reservaId: id, cuerpo: { nota: "  María Pérez, 987654321  " } }, conBase);
      expect(r.reserva).toEqual({ id, apoyo_estado: "coordinado", apoyo_nota: "María Pérez, 987654321" });
      const fila = await leer(id);
      expect(fila).toMatchObject({ apoyoEstado: "coordinado", apoyoNota: "María Pérez, 987654321", requiereApoyo: true });
      const lista = await listarApoyoPorCoordinar(base, CONFIG);
      expect(lista.some((x) => x.id === id)).toBe(false);

      await marcarApoyoCoordinado({ reservaId: id, cuerpo: { nota: "Rosa, 911222333" } }, conBase);
      expect((await leer(id)).apoyoNota).toBe("Rosa, 911222333");
      await marcarApoyoCoordinado({ reservaId: id, cuerpo: { nota: "" } }, conBase);
      expect(await leer(id)).toMatchObject({ apoyoEstado: "coordinado", apoyoNota: null });

      const sinApoyo = await poner({ inicio: en(nuevoDia(), "10:00") });
      await expect(marcarApoyoCoordinado({ reservaId: sinApoyo.id, cuerpo: {} }, conBase)).rejects.toMatchObject({ status: 409, message: "Esta reserva no requiere apoyo." });
      expect(await leer(sinApoyo.id)).toMatchObject({ requiereApoyo: false, apoyoEstado: null });

      const cancelada = await poner({ inicio: en(diaIniciado(), "10:00"), apoyo: "por_coordinar", estado: "cancelada" });
      await expect(marcarApoyoCoordinado({ reservaId: cancelada.id, cuerpo: {} }, conBase)).rejects.toMatchObject({ status: 409 });
    });
  });

  // ---------- 10.8 Reprogramar a nombre del cliente ----------
  describe("reprogramar (administrador)", () => {
    const depsAdmin = (): DependenciasReprogramarAdmin => ({ ...conBase, leerConfig: async () => CONFIG, equipoIds: [E[0], E[1]] });
    const reprogramar = (reservaId: string, inicio: string) => reprogramarReservaPorAdmin({ reservaId, cuerpo: { inicio }, adminId: admin.id, ahora: AHORA }, depsAdmin());

    it("una confirmada con apoyo coordinado se mueve: mismo id, pago, monto y estado; por_coordinar; queda registrado y reaparece en la lista de apoyo", async () => {
      const [dia, nuevo] = [nuevoDia(), nuevoDia()];
      const { id, dueno } = await poner({ inicio: en(dia, "10:00"), apoyo: "coordinado", nota: "Rosa, 911222333", horas: 3.5, equipo: E[0] });
      const antes = await leer(id);
      expect(antes.reprogramadaPor).toBeNull();
      expect(antes.reprogramadaEn).toBeNull();

      const r = await reprogramar(id, en(nuevo, "09:00"));
      expect(r.reserva).toMatchObject({ id, estado: "confirmada", inicio: `${nuevo}T09:00:00-05:00`, fin: `${nuevo}T12:30:00-05:00`, apoyo_estado: "por_coordinar", reprogramada_por: admin.id });

      const despues = await leer(id);
      expect(despues.id).toBe(antes.id);
      expect(despues.pagoId).toBe(dueno.pagoId);
      for (const campo of ["monto", "precioLista", "estado", "primeraGratis", "horasGratisAplicadas", "horasAgenda", "horasTrabajo", "expiraEn", "membresiaId"] as const) {
        expect(despues[campo], campo).toEqual(antes[campo]);
      }
      expect(despues.apoyoEstado).toBe("por_coordinar");
      expect(despues.apoyoNota).toBe("Rosa, 911222333");
      expect(despues.reprogramadaPor).toBe(admin.id);
      expect(despues.reprogramadaEn).toBeInstanceOf(Date);
      expect(despues.inicio.toISOString()).toBe(new Date(en(nuevo, "09:00")).toISOString());
      expect(despues.finBloqueo.getTime() - despues.fin.getTime()).toBe(3_600_000);

      const apoyo = await listarApoyoPorCoordinar(base, CONFIG);
      expect(apoyo.find((x) => x.id === id)).toMatchObject({ apoyo_nota: "Rosa, 911222333", inicio: `${nuevo}T09:00:00-05:00` });
      const lista = await listarReservas(base, { estado: "confirmada" }, CONFIG);
      expect(lista.reservas.find((x) => x.id === id)).toMatchObject({ reprogramada_en: expect.any(String), reprogramada_por: { id: admin.id, nombre: "Prueba admin" } });
    });

    it("a menos de 24 h del servicio actual se acepta; a menos de 48 h del nuevo horario → 422", async () => {
      // El servicio actual es 22 h después de AHORA (martes 6 de enero de 2099, 08:00).
      const { id } = await poner({ inicio: en("2099-01-06", "08:00"), equipo: E[0] });
      const [nuevo] = [nuevoDia()];
      await expect(reprogramar(id, en("2099-01-06", "09:00"))).rejects.toMatchObject({ status: 422, message: expect.stringContaining("48 horas") });
      expect((await leer(id)).reprogramadaPor).toBeNull();
      const r = await reprogramar(id, en(nuevo, "10:00"));
      expect(r.reserva.inicio).toBe(`${nuevo}T10:00:00-05:00`);
    });

    it("sin cupo → 409 y la reserva conserva su horario anterior", async () => {
      const [dia, nuevo] = [nuevoDia(), nuevoDia()];
      const { id } = await poner({ inicio: en(dia, "10:00"), equipo: E[0] });
      await poner({ inicio: en(nuevo, "10:00"), equipo: E[0] });
      await poner({ inicio: en(nuevo, "10:00"), equipo: E[1] });
      const antes = await leer(id);
      await expect(reprogramar(id, en(nuevo, "11:00"))).rejects.toMatchObject({ status: 409, message: "Esa hora ya no está disponible. Elige otra hora." });
      expect(await leer(id)).toEqual(antes);
    });

    it("dos reprogramaciones por el último cupo → un 200 y un 409, sin solape", async () => {
      const [d1, d2, nuevo] = [nuevoDia(), nuevoDia(), nuevoDia()];
      await poner({ inicio: en(nuevo, "10:00"), equipo: E[0] }); // el equipo 0 está ocupado: solo queda el equipo 1
      const a = await poner({ inicio: en(d1, "10:00"), equipo: E[0] });
      const b = await poner({ inicio: en(d2, "10:00"), equipo: E[1] });
      const r = await Promise.allSettled([reprogramar(a.id, en(nuevo, "10:00")), reprogramar(b.id, en(nuevo, "11:00"))]);
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
      const enNuevo = await base.select().from(reservas).where(and(eq(reservas.equipoId, E[1]), inArray(reservas.id, [a.id, b.id]), ne(reservas.estado, "cancelada")));
      const movidas = enNuevo.filter((x) => x.inicio.toISOString().startsWith(new Date(en(nuevo, "10:00")).toISOString().slice(0, 10)));
      expect(movidas).toHaveLength(1);
    });

    it("la reprogramación del cliente (ítem 12) no escribe reprogramada_*", async () => {
      const [dia, nuevo] = [nuevoDia(), nuevoDia()];
      const { id, dueno } = await poner({ inicio: en(dia, "10:00"), equipo: E[0] });
      const usuario: Usuario = { id: dueno.usuarioId, correo: `${dueno.usuarioId}@tiza.test`, nombre: "Prueba agenda", celular: "900000000", rol: "cliente" };
      await reprogramarReserva(
        { usuario, reservaId: id, cuerpo: { inicio: en(nuevo, "10:00") }, ahora: AHORA },
        { ...conBase, leerConfig: async () => CONFIG, numeroWhatsapp: () => null, equipoIds: [E[0], E[1]] },
      );
      const fila = await leer(id);
      expect(fila.inicio.toISOString()).toBe(new Date(en(nuevo, "10:00")).toISOString());
      expect(fila.reprogramadaPor).toBeNull();
      expect(fila.reprogramadaEn).toBeNull();
    });

    it("una reserva completada, cancelada o expirada, o un servicio ya iniciado → 409", async () => {
      for (const estado of ["completada", "cancelada", "expirada"] as const) {
        const { id } = await poner({ inicio: en(nuevoDia(), "10:00"), estado });
        await expect(reprogramar(id, en(nuevoDia(), "10:00")), estado).rejects.toMatchObject({ status: 409 });
      }
      const iniciada = await poner({ inicio: en(diaIniciado(), "10:00") });
      await expect(reprogramar(iniciada.id, en(nuevoDia(), "10:00"))).rejects.toMatchObject({ status: 409, message: "El servicio ya empezó; no se puede reprogramar." });
    });
  });
});
