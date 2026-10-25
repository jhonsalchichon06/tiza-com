import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "@/lib/__fixtures__/configuracion";
import type { ErrorApi } from "@/lib/errores";
import { leerDetalleReserva } from "@/lib/perfil/detalle";
import { listarHistorial } from "@/lib/perfil/reservas";
import { crearResena } from "@/lib/resenas/crear";
import { editarResena } from "@/lib/resenas/editar";
import { decidirResena, listarPendientes, revisionDe } from "@/lib/resenas/moderar";
import { leerOpinionesPublicas } from "@/lib/resenas/publicas";
import { resenas } from "./esquema";
import { PRUEBAS_BD_ACTIVAS, contarRastros, crearBasePruebas, crearEscenario, type BasePruebas } from "./pruebas-bd";

// Reseñas contra la rama `pruebas` de Neon (change `resenas`): escritura (una por limpieza, solo completadas, CHECK), edición,
// carreras, aislamiento entre clientes, moderación y lectura pública. Corre con PRUEBAS_BD=1.
// Prefijo PROPIO ("prueba-resenas-"): otras suites prueban a la vez en la misma rama y no deben borrarme ni contarme.
const PREFIJOS = { usuario: "prueba-resenas-", equipo: "PRUEBA-resenas-" };
const MARCA = `MARCA-${crypto.randomUUID().slice(0, 8)}`; // distingue mis comentarios de los de otros en las lecturas globales
const texto = (resto: string) => `${MARCA} ${resto}`;
const AHORA = new Date("2098-03-01T12:00:00Z");

const codigoDe = (error: unknown): string | undefined => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
};
async function fallo(promesa: Promise<unknown>): Promise<ErrorApi & { code?: string }> {
  try {
    await promesa;
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("se esperaba un error");
}

describe.skipIf(!PRUEBAS_BD_ACTIVAS)("reseñas (Neon)", () => {
  let ctx: ReturnType<typeof crearBasePruebas>;
  let base: BasePruebas;
  let esc: Awaited<ReturnType<typeof crearEscenario>>;
  let admin: { id: string };
  const deps = () => ({ base: () => base });
  const depsDetalle = () => ({ base: () => base, leerConfig: async () => VALORES_DEL_DISENO });
  const crear = (u: { id: string }, reservaId: string, estrellas = 5, comentario = texto("Todo quedó muy limpio, gracias.")) =>
    crearResena({ usuarioId: u.id, reservaId, cuerpo: { estrellas, comentario } }, deps());
  const editar = (u: { id: string }, reservaId: string, comentario: string, estrellas = 4) =>
    editarResena({ usuarioId: u.id, reservaId, cuerpo: { estrellas, comentario } }, deps());
  const filaDe = async (reservaId: string) => (await base.select().from(resenas).where(eq(resenas.reservaId, reservaId)))[0];
  const contar = async (reservaId: string) => (await base.select({ id: resenas.id }).from(resenas).where(eq(resenas.reservaId, reservaId))).length;
  // Una reseña `pendiente` ya creada (por la ruta real) sobre una reserva completada nueva.
  async function conResena(comentario: string) {
    const r = await esc.crearReservaEn("completada");
    const creada = await crear(r.usuario, r.reservaId, 5, comentario);
    return { ...r, resenaId: creada.id };
  }

  beforeAll(async () => {
    ctx = crearBasePruebas();
    base = ctx.base;
    esc = await crearEscenario(base, PREFIJOS);
    admin = await esc.crearAdmin();
  });

  afterAll(async () => {
    await esc?.limpiar();
    if (base) expect(await contarRastros(base, PREFIJOS)).toBe(0);
    await ctx?.cerrar();
  });

  describe("escritura", () => {
    it("crea la reseña pendiente de una reserva completada", async () => {
      const r = await esc.crearReservaEn("completada");
      const creada = await crear(r.usuario, r.reservaId);
      expect(creada).toMatchObject({ estrellas: 5, estado: "pendiente" });
      const fila = await filaDe(r.reservaId);
      expect(fila).toMatchObject({ estado: "pendiente", revisadaPor: null, revisadaEn: null });
    });

    it.each(["confirmada", "pendiente", "cancelada", "expirada"] as const)("una reserva %s da 409 y no deja ninguna fila", async (estado) => {
      const r = await esc.crearReservaEn(estado);
      expect(await fallo(crear(r.usuario, r.reservaId))).toMatchObject({ status: 409 });
      expect(await contar(r.reservaId)).toBe(0);
    });

    it("una segunda reseña da 409 por la clave única y la primera no cambia", async () => {
      const r = await esc.crearReservaEn("completada");
      await crear(r.usuario, r.reservaId, 5, texto("Primera y única reseña."));
      expect(await fallo(crear(r.usuario, r.reservaId, 1, texto("Intento de segunda reseña.")))).toMatchObject({ status: 409, message: "Ya dejaste tu reseña de esta limpieza." });
      expect(await contar(r.reservaId)).toBe(1);
      expect((await filaDe(r.reservaId)).comentario).toBe(texto("Primera y única reseña."));
    });

    it("la base rechaza una segunda fila con el mismo reserva_id aunque se salte el código", async () => {
      const r = await esc.crearReservaEn("completada");
      await base.insert(resenas).values({ reservaId: r.reservaId, estrellas: 3, comentario: texto("Directa uno.") });
      const e = await fallo(base.insert(resenas).values({ reservaId: r.reservaId, estrellas: 3, comentario: texto("Directa dos.") }));
      expect(codigoDe(e)).toBe("23505");
    });

    it("dos POST simultáneos: uno 201, otro 409, queda una sola fila", async () => {
      const r = await esc.crearReservaEn("completada");
      const resultados = await Promise.allSettled([crear(r.usuario, r.reservaId, 5, texto("Simultánea A.")), crear(r.usuario, r.reservaId, 4, texto("Simultánea B."))]);
      expect(resultados.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const rechazada = resultados.find((x): x is PromiseRejectedResult => x.status === "rejected")!;
      expect((rechazada.reason as ErrorApi).status).toBe(409);
      expect(await contar(r.reservaId)).toBe(1);
    });

    it("estrellas 0 y 6 las rechaza el CHECK de la base", async () => {
      const r = await esc.crearReservaEn("completada");
      for (const estrellas of [0, 6]) {
        const e = await fallo(base.insert(resenas).values({ reservaId: r.reservaId, estrellas, comentario: texto("Fuera de rango.") }));
        expect(codigoDe(e)).toBe("23514");
      }
      expect(await contar(r.reservaId)).toBe(0);
    });

    it("el CHECK de revisión coherente rechaza revisada_por sin revisada_en, y aprobada sin revisor", async () => {
      const r = await esc.crearReservaEn("completada");
      const sinFecha = await fallo(base.insert(resenas).values({ reservaId: r.reservaId, estrellas: 5, comentario: texto("Sin fecha."), estado: "aprobada", revisadaPor: admin.id }));
      expect(codigoDe(sinFecha)).toBe("23514");
      const sinRevisor = await fallo(base.insert(resenas).values({ reservaId: r.reservaId, estrellas: 5, comentario: texto("Sin revisor."), estado: "rechazada", revisadaEn: new Date() }));
      expect(codigoDe(sinRevisor)).toBe("23514");
      const pendienteConRevisor = await fallo(base.insert(resenas).values({ reservaId: r.reservaId, estrellas: 5, comentario: texto("Pendiente con revisor."), revisadaPor: admin.id, revisadaEn: new Date() }));
      expect(codigoDe(pendienteConRevisor)).toBe("23514");
      expect(await contar(r.reservaId)).toBe(0);
    });

    it("editar una rechazada la deja pendiente y sin datos de revisión", async () => {
      const r = await conResena(texto("Para rechazar."));
      await decidirResena({ id: r.resenaId, decision: "rechazada", adminId: admin.id }, deps());
      expect(await filaDe(r.reservaId)).toMatchObject({ estado: "rechazada", revisadaPor: admin.id });
      const editada = await editar(r.usuario, r.reservaId, texto("Corregida y reenviada."), 3);
      expect(editada).toMatchObject({ estado: "pendiente", estrellas: 3, comentario: texto("Corregida y reenviada.") });
      expect(await filaDe(r.reservaId)).toMatchObject({ estado: "pendiente", revisadaPor: null, revisadaEn: null, estrellas: 3 });
      expect(await contar(r.reservaId)).toBe(1);
    });

    it("editar una pendiente la deja pendiente; editar una aprobada da 409 sin cambios", async () => {
      const r = await conResena(texto("Para aprobar."));
      expect(await editar(r.usuario, r.reservaId, texto("Editada antes de revisar."))).toMatchObject({ estado: "pendiente" });
      await decidirResena({ id: r.resenaId, decision: "aprobada", adminId: admin.id }, deps());
      const antes = await filaDe(r.reservaId);
      expect(await fallo(editar(r.usuario, r.reservaId, texto("Cambio después de aprobada.")))).toMatchObject({ status: 409 });
      expect(await filaDe(r.reservaId)).toEqual(antes);
    });

    it("editar sin tener reseña da 404", async () => {
      const r = await esc.crearReservaEn("completada");
      expect(await fallo(editar(r.usuario, r.reservaId, texto("No hay reseña previa.")))).toMatchObject({ status: 404 });
    });

    it("aprobar y editar a la vez: nunca queda una aprobada con texto distinto del que vio el administrador", async () => {
      for (let i = 0; i < 6; i++) {
        const original = texto(`Texto original ${i} que revisó el administrador.`);
        const r = await conResena(original);
        const huella = revisionDe(5, original);
        const resultados = await Promise.allSettled([
          decidirResena({ id: r.resenaId, decision: "aprobada", adminId: admin.id, revision: huella }, deps()),
          editar(r.usuario, r.reservaId, texto(`Texto cambiado ${i} a último momento.`)),
        ]);
        expect(resultados.filter((x) => x.status === "fulfilled")).toHaveLength(1);
        const rechazada = resultados.find((x): x is PromiseRejectedResult => x.status === "rejected")!;
        expect((rechazada.reason as ErrorApi).status).toBe(409);
        const fila = await filaDe(r.reservaId);
        if (fila.estado === "aprobada") expect(fila.comentario).toBe(original);
        else expect(fila).toMatchObject({ estado: "pendiente", revisadaPor: null });
      }
    });
  });

  describe("aislamiento entre clientes", () => {
    it("el cliente A no ve (404) ni escribe en la reserva de B; ni su detalle ni su historial incluyen reseñas de B", async () => {
      const a = await esc.crearReservaEn("completada");
      const b = await esc.crearReservaEn("completada");
      await crear(b.usuario, b.reservaId, 5, texto("Reseña de B, privada de B."));

      expect(await fallo(crear(a.usuario, b.reservaId))).toMatchObject({ status: 404 });
      expect(await fallo(editar(a.usuario, b.reservaId, texto("Intento de A sobre B.")))).toMatchObject({ status: 404 });
      expect(await contar(b.reservaId)).toBe(1);
      expect((await filaDe(b.reservaId)).comentario).toBe(texto("Reseña de B, privada de B."));

      expect(await fallo(leerDetalleReserva({ usuario: a.usuario, reservaId: b.reservaId, ahora: AHORA }, depsDetalle()))).toMatchObject({ status: 404 });
      const detalleA = await leerDetalleReserva({ usuario: a.usuario, reservaId: a.reservaId, ahora: AHORA }, depsDetalle());
      expect(detalleA).toMatchObject({ resena: null, puede_resenar: true });
      expect(JSON.stringify(detalleA)).not.toContain("Reseña de B");

      const historialA = await listarHistorial(base, a.usuario.id, VALORES_DEL_DISENO);
      expect(historialA.map((h) => h.id)).toEqual([a.reservaId]);
      expect(historialA[0].resena_estado).toBeNull();
      const historialB = await listarHistorial(base, b.usuario.id, VALORES_DEL_DISENO);
      expect(historialB[0].resena_estado).toBe("pendiente");
    });

    it("el detalle del dueño trae su reseña y el estado, sin quién la revisó", async () => {
      const r = await conResena(texto("Detalle del dueño."));
      await decidirResena({ id: r.resenaId, decision: "aprobada", adminId: admin.id }, deps());
      const d = await leerDetalleReserva({ usuario: r.usuario, reservaId: r.reservaId, ahora: AHORA }, depsDetalle());
      expect(d.resena).toEqual({ estrellas: 5, comentario: texto("Detalle del dueño."), estado: "aprobada" });
      expect(d.puede_resenar).toBe(false);
      expect(JSON.stringify(d)).not.toMatch(/revisad/);
    });
  });

  describe("moderación", () => {
    it("la cola trae solo las pendientes, de la más antigua a la más reciente, con cliente, distrito y fechas", async () => {
      const M = `COLA-${crypto.randomUUID().slice(0, 8)}`; // solo las filas de esta prueba (otras ya dejaron pendientes)
      const [x, y, z, ya] = [await esc.crearReservaEn("completada"), await esc.crearReservaEn("completada"), await esc.crearReservaEn("completada"), await esc.crearReservaEn("completada")];
      // creada_en explícita para fijar el orden (la más antigua primero).
      const filas = [
        { r: y, creadaEn: new Date("2098-03-10T10:00:00Z"), c: `${M} Segunda en la cola.` },
        { r: z, creadaEn: new Date("2098-03-11T10:00:00Z"), c: `${M} Tercera en la cola.` },
        { r: x, creadaEn: new Date("2098-03-09T10:00:00Z"), c: `${M} Primera en la cola.` },
      ];
      for (const f of filas) await base.insert(resenas).values({ reservaId: f.r.reservaId, estrellas: 4, comentario: f.c, creadaEn: f.creadaEn });
      const decidida = await crear(ya.usuario, ya.reservaId, 5, `${M} Ya aprobada: no entra.`);
      await decidirResena({ id: decidida.id, decision: "aprobada", adminId: admin.id }, deps());

      const cola = (await listarPendientes(base, "America/Lima")).filter((c) => c.comentario.startsWith(M));
      expect(cola.map((c) => c.comentario)).toEqual([`${M} Primera en la cola.`, `${M} Segunda en la cola.`, `${M} Tercera en la cola.`]);
      expect(cola[0]).toMatchObject({ cliente: "Prueba agenda", distrito: "Miraflores", estrellas: 4 });
      expect(cola[0].inicio.startsWith("2098-03")).toBe(true);
      expect(cola[0].revision).toBe(revisionDe(4, `${M} Primera en la cola.`));
    });

    it("aprobar y rechazar dejan autor y fecha; repetir o contradecir da 409", async () => {
      const a = await conResena(texto("Para aprobar sola."));
      const antes = Date.now();
      const ok = await decidirResena({ id: a.resenaId, decision: "aprobada", adminId: admin.id }, deps());
      expect(ok.resena.estado).toBe("aprobada");
      expect(await filaDe(a.reservaId)).toMatchObject({ estado: "aprobada", revisadaPor: admin.id });
      expect(new Date((await filaDe(a.reservaId)).revisadaEn!).getTime()).toBeGreaterThan(antes - 60_000);
      expect(await fallo(decidirResena({ id: a.resenaId, decision: "aprobada", adminId: admin.id }, deps()))).toMatchObject({ status: 409 });
      expect(await fallo(decidirResena({ id: a.resenaId, decision: "rechazada", adminId: admin.id }, deps()))).toMatchObject({ status: 409 });
      expect((await filaDe(a.reservaId)).estado).toBe("aprobada");

      const b = await conResena(texto("Para rechazar sola."));
      await decidirResena({ id: b.resenaId, decision: "rechazada", adminId: admin.id }, deps());
      expect(await filaDe(b.reservaId)).toMatchObject({ estado: "rechazada", revisadaPor: admin.id });
    });

    it("dos decisiones simultáneas: una se aplica y la otra recibe 409", async () => {
      const r = await conResena(texto("Decisión doble."));
      const resultados = await Promise.allSettled([
        decidirResena({ id: r.resenaId, decision: "aprobada", adminId: admin.id }, deps()),
        decidirResena({ id: r.resenaId, decision: "rechazada", adminId: admin.id }, deps()),
      ]);
      expect(resultados.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(((resultados.find((x) => x.status === "rejected") as PromiseRejectedResult).reason as ErrorApi).status).toBe(409);
    });

    it("una reseña inexistente da 404", async () => {
      expect(await fallo(decidirResena({ id: "00000000-0000-4000-8000-000000000000", decision: "aprobada", adminId: admin.id }, deps()))).toMatchObject({ status: 404 });
    });
  });

  describe("lectura pública", () => {
    it("con una pendiente, una rechazada y una aprobada devuelve solo la aprobada, con el nombre de pila y sin datos personales", async () => {
      const M = `PUB-${crypto.randomUUID().slice(0, 8)}`;
      const pendiente = await conResena(`${M} Pública: pendiente.`);
      const rechazada = await conResena(`${M} Pública: rechazada.`);
      const aprobada = await conResena(`${M} Pública: aprobada.`);
      await decidirResena({ id: rechazada.resenaId, decision: "rechazada", adminId: admin.id }, deps());
      await decidirResena({ id: aprobada.resenaId, decision: "aprobada", adminId: admin.id }, deps());

      const todas = await leerOpinionesPublicas(base);
      const mias = todas.filter((o) => o.comentario.startsWith(M));
      expect(mias).toHaveLength(1);
      expect(Object.keys(mias[0]).sort()).toEqual(["comentario", "distrito", "estrellas", "mes", "nombrePila"]);
      expect(mias[0]).toMatchObject({ nombrePila: "Prueba", distrito: "Miraflores", comentario: `${M} Pública: aprobada.`, estrellas: 5 });
      expect(mias[0].mes).toMatch(/^\w+ de \d{4}$/);
      const serializado = JSON.stringify(todas);
      for (const prohibido of [pendiente.usuarioId, aprobada.usuarioId, "@tiza.test", "900000000", "Av. Larco", "agenda", "pendiente."]) expect(serializado).not.toContain(prohibido);
      expect(todas.length).toBeLessThanOrEqual(6);
    });

    it("sin ninguna aprobada propia, mis comentarios no aparecen", async () => {
      await conResena(texto("Solo pendiente: no se publica."));
      const mias = (await leerOpinionesPublicas(base)).filter((o) => o.comentario.includes("Solo pendiente"));
      expect(mias).toEqual([]);
    });
  });

});
