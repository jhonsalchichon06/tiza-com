import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "@/lib/__fixtures__/configuracion";
import { instanteLocal } from "@/lib/agenda/horario";
import { ErrorApi } from "@/lib/errores";
import { MENSAJE_MEMBRESIA_EN_REVISION, crearPrimeraReserva, type DependenciasCrear } from "@/lib/reservas/crear";
import { decidirLimpiezaGratis } from "@/lib/reservas/gratis";
import { MENSAJE_GRATIS_DEL_HOGAR_USADA } from "@/lib/reservas/unicidad";
import { creditoParaReserva } from "@/lib/reservas/credito";
import { leerMembresiaQueAutoriza } from "@/lib/reservas/membresia-vigente";
import { crearRutaCotizacion } from "@/lib/reservas/rutas";
import { motivoSinGratis } from "@/lib/reservas/gratis";
import type { Usuario } from "@/lib/sesion";
import { membresias, pagos, reservas } from "./esquema";
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

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// Una limpieza gratis por cliente y por hogar contra la rama `pruebas` de Neon (change una-limpieza-gratis-por-hogar):
// los dos índices únicos parciales, `crearPrimeraReserva` de punta a punta, la cotización y la concurrencia.
// Corre con PRUEBAS_BD=1. Equipos de prueba INACTIVOS, fechas de 2099 y datos con el prefijo `prueba-agenda-`.
const AHORA = instanteLocal("2099-01-05", "10:00", "America/Lima"); // lunes

// Un día distinto para cada reserva creada (lunes a sábado desde el 12 de enero de 2099, dentro de los 3 meses de AHORA).
const DIAS: string[] = [];
for (let t = Date.UTC(2099, 0, 12); DIAS.length < 70; t += 86_400_000) {
  if (new Date(t).getUTCDay() !== 0) DIAS.push(new Date(t).toISOString().slice(0, 10));
}
let siguienteDia = 0;
const nuevoDia = () => DIAS[siguienteDia++];

type Tx = Parameters<Parameters<BasePruebas["transaction"]>[0]>[0];
type Estado = "pendiente" | "confirmada" | "completada" | "cancelada" | "expirada";

describe.skipIf(!PRUEBAS_BD_ACTIVAS)("una limpieza gratis por cliente y por hogar (Neon)", () => {
  let ctx: ReturnType<typeof crearBasePruebas>;
  let base: BasePruebas;
  let esc: Awaited<ReturnType<typeof crearEscenario>>;
  let duenos: Dueno[];
  let contadorHogar = 0;
  let diaDeFila = 0;

  beforeAll(async () => {
    ctx = crearBasePruebas();
    base = ctx.base;
    esc = await crearEscenario(base);
    duenos = await esc.crearDuenos(8);
  });

  afterAll(async () => {
    await esc?.limpiar();
    if (base) expect(await contarRastros(base)).toBe(0);
    await ctx?.cerrar();
  });

  // Un número de casa propio de cada prueba: el hogar no se comparte entre pruebas aunque las filas persistan.
  const numeroNuevo = () => String(1000 + ++contadorHogar);

  // ---------------------------------------------------------------------------------------------------------------
  // 1. Los índices, directamente (cada prueba se deshace con ROLLBACK)
  // ---------------------------------------------------------------------------------------------------------------
  describe("índices únicos parciales", () => {
    // Devuelve "ok" o `SQLSTATE:índice`.
    async function intentar(tx: Tx, fila: typeof reservas.$inferInsert): Promise<string> {
      try {
        await tx.transaction(async (sp) => {
          await sp.insert(reservas).values(fila);
        });
        return "ok";
      } catch (error) {
        const e = error as { cause?: { code?: string; constraint?: string } };
        return `${e.cause?.code ?? "error"}:${e.cause?.constraint ?? ""}`;
      }
    }

    // Pago extra del mismo cliente (una reserva viva por pago); se deshace con la transacción.
    async function pagoNuevo(tx: Tx, d: Dueno): Promise<string> {
      const [p] = await tx
        .insert(pagos)
        .values({ usuarioId: d.usuarioId, concepto: "membresia", membresiaId: d.membresiaId, monto: 26700, metodo: "yape", comprobanteRuta: `comprobantes/${d.usuarioId}/extra.jpg` })
        .returning({ id: pagos.id });
      return p.id;
    }

    // Una fila válida en un día propio (el equipo es el mismo, así que cada fila va en otro día para no solaparse).
    const fila = (d: Dueno, extra: Partial<Parameters<typeof filaReserva>[0]> & { pagoId?: string }) => {
      const dia = new Date(Date.UTC(2099, 4, 1 + diaDeFila++)).toISOString().slice(0, 10);
      return filaReserva({ ...d, equipoId: esc.equipoIds[0], inicio: `${dia}T10:00:00-05:00`, horasAgenda: 3, ...extra });
    };

    const POR_CLIENTE = "23505:reservas_primera_gratis_por_cliente";
    const POR_HOGAR = "23505:reservas_primera_gratis_por_hogar";

    it("una segunda gratis viva del mismo cliente se rechaza por el índice del cliente", async () => {
      await enRollback(base, async (tx) => {
        const d = duenos[0];
        const h1 = { numero: "1", direccionNormalizada: "prueba indice a 1" };
        const h2 = { numero: "2", direccionNormalizada: "prueba indice a 2" };
        expect(await intentar(tx, fila(d, { primeraGratis: true, estado: "confirmada", ...h1 }))).toBe("ok");
        const pago2 = await pagoNuevo(tx, d);
        expect(await intentar(tx, fila(d, { primeraGratis: true, estado: "confirmada", pagoId: pago2, ...h2 }))).toBe(POR_CLIENTE);
      });
    });

    it("la misma clave de hogar de otro cliente se rechaza por el índice del hogar", async () => {
      await enRollback(base, async (tx) => {
        const h = { numero: "3", direccionNormalizada: "prueba indice b 3", departamentoNormalizado: "dpto 302" };
        expect(await intentar(tx, fila(duenos[0], { primeraGratis: true, estado: "confirmada", ...h }))).toBe("ok");
        expect(await intentar(tx, fila(duenos[1], { primeraGratis: true, estado: "confirmada", ...h }))).toBe(POR_HOGAR);
      });
    });

    it.each(["cancelada", "expirada"] as const)("con la primera %s se acepta otra gratis del cliente y del hogar", async (estado) => {
      await enRollback(base, async (tx) => {
        const h = { numero: "4", direccionNormalizada: `prueba indice c ${estado}` };
        expect(await intentar(tx, fila(duenos[0], { primeraGratis: true, estado, ...h }))).toBe("ok");
        // Otra cuenta, mismo hogar.
        expect(await intentar(tx, fila(duenos[1], { primeraGratis: true, estado: "confirmada", ...h }))).toBe("ok");
        // El mismo cliente, otro hogar.
        const pago2 = await pagoNuevo(tx, duenos[0]);
        expect(await intentar(tx, fila(duenos[0], { primeraGratis: true, estado: "confirmada", pagoId: pago2, direccionNormalizada: `prueba indice c2 ${estado}` }))).toBe("ok");
      });
    });

    it.each(["completada", "confirmada", "pendiente"] as const)("con la primera %s se rechaza otra gratis del hogar", async (estado) => {
      await enRollback(base, async (tx) => {
        const h = { numero: "5", direccionNormalizada: `prueba indice d ${estado}` };
        expect(await intentar(tx, fila(duenos[0], { primeraGratis: true, estado, ...h }))).toBe("ok");
        expect(await intentar(tx, fila(duenos[1], { primeraGratis: true, estado: "confirmada", ...h }))).toBe(POR_HOGAR);
      });
    });

    it("las reservas con primera_gratis falso del mismo hogar no estorban", async () => {
      await enRollback(base, async (tx) => {
        const h = { numero: "6", direccionNormalizada: "prueba indice e 6" };
        expect(await intentar(tx, fila(duenos[0], { primeraGratis: false, estado: "confirmada", ...h }))).toBe("ok");
        expect(await intentar(tx, fila(duenos[1], { primeraGratis: false, estado: "confirmada", ...h }))).toBe("ok");
        expect(await intentar(tx, fila(duenos[2], { primeraGratis: true, estado: "confirmada", ...h }))).toBe("ok");
      });
    });

    it("el mismo edificio con departamento 302 y 401 se acepta", async () => {
      await enRollback(base, async (tx) => {
        const h = { numero: "7", direccionNormalizada: "prueba indice f 7" };
        expect(await intentar(tx, fila(duenos[0], { primeraGratis: true, estado: "confirmada", departamentoNormalizado: "dpto 302", ...h }))).toBe("ok");
        expect(await intentar(tx, fila(duenos[1], { primeraGratis: true, estado: "confirmada", departamentoNormalizado: "dpto 401", ...h }))).toBe("ok");
      });
    });

    it("departamento vacío frente a dpto 302 se acepta", async () => {
      await enRollback(base, async (tx) => {
        const h = { numero: "8", direccionNormalizada: "prueba indice g 8" };
        expect(await intentar(tx, fila(duenos[0], { primeraGratis: true, estado: "confirmada", departamentoNormalizado: "", ...h }))).toBe("ok");
        expect(await intentar(tx, fila(duenos[1], { primeraGratis: true, estado: "confirmada", departamentoNormalizado: "dpto 302", ...h }))).toBe("ok");
      });
    });

    it("el mismo hogar en otro distrito se acepta", async () => {
      await enRollback(base, async (tx) => {
        const h = { numero: "9", direccionNormalizada: "prueba indice h 9" };
        expect(await intentar(tx, fila(duenos[0], { primeraGratis: true, estado: "confirmada", distrito: "Miraflores", ...h }))).toBe("ok");
        expect(await intentar(tx, fila(duenos[1], { primeraGratis: true, estado: "confirmada", distrito: "San Isidro", ...h }))).toBe("ok");
      });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  // 2. crearPrimeraReserva de punta a punta
  // ---------------------------------------------------------------------------------------------------------------
  const cuerpo = (dia: string, direccion: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    servicio: { tipo: "profunda", dormitorios: 2, banos: 1 },
    inicio: `${dia}T10:00:00-05:00`,
    direccion: { distrito: "Miraflores", ...direccion },
    metodo: "yape",
    comprobante: "comprobante-de-prueba",
    ...extra,
  });

  const dependencias = (usuario: Usuario, equipoIds: number[], baseUsada: () => unknown = () => base): DependenciasCrear => ({
    leerConfig: async () => VALORES_DEL_DISENO,
    verificarImagen: async () => ({ ruta: `comprobantes/${usuario.id}/bd.jpg`, tipo: "image/jpeg", tamano: 1000 }),
    base: baseUsada as DependenciasCrear["base"],
    equipoIds,
    numeroWhatsapp: () => null,
  });
  const dosEquipos = () => esc.equipoIds.slice(0, 2);
  const crear = (usuario: Usuario, c: unknown, equipoIds = dosEquipos(), baseUsada?: () => unknown) =>
    crearPrimeraReserva({ usuario, cuerpo: c, ahora: AHORA }, dependencias(usuario, equipoIds, baseUsada));

  const filasDe = async (usuarioId: string) => ({
    membresias: await base.select().from(membresias).where(eq(membresias.usuarioId, usuarioId)),
    pagos: await base.select().from(pagos).where(eq(pagos.usuarioId, usuarioId)),
    reservas: await base.select().from(reservas).where(eq(reservas.usuarioId, usuarioId)),
  });
  const totalDe = async (usuarioId: string) => {
    const f = await filasDe(usuarioId);
    return f.membresias.length + f.pagos.length + f.reservas.length;
  };
  const error = async (promesa: Promise<unknown>) => {
    try {
      await promesa;
    } catch (e) {
      return e as ErrorApi;
    }
    throw new Error("se esperaba un error");
  };
  const estadoDe = async (id: string) => (await base.select({ estado: reservas.estado }).from(reservas).where(eq(reservas.id, id)))[0].estado;

  // Una reserva ya guardada (de otra cuenta) en un hogar, para preparar escenarios. Usa un dueño con su membresía y pago.
  async function sembrar(d: Dueno, hogar: { numero: string; direccionNormalizada: string; departamentoNormalizado?: string }, extra: Partial<Parameters<typeof filaReserva>[0]> = {}) {
    const dia = nuevoDia();
    const [r] = await base
      .insert(reservas)
      .values(filaReserva({ ...d, equipoId: esc.equipoIds[2], inicio: `${dia}T10:00:00-05:00`, horasAgenda: 3, estado: "confirmada", primeraGratis: true, ...hogar, ...extra }))
      .returning({ id: reservas.id });
    return r.id;
  }
  const hogarDe = (numero: string, departamentoNormalizado = "") => ({ numero, direccionNormalizada: `avenida larco ${numero}`, departamentoNormalizado });

  describe("segunda cuenta en el mismo hogar", () => {
    it("la misma dirección escrita distinto paga el precio completo con descuento de miembro", async () => {
      const [a, b] = await esc.crearClientes(2);
      const numero = numeroNuevo();
      await crear(a, cuerpo(nuevoDia(), { calle: "Av. Larco", numero, departamento: "Dpto 302" }));
      await crear(b, cuerpo(nuevoDia(), { calle: "Avenida Larco", numero, departamento: "dpto. 302" }));

      const fa = await filasDe(a.id);
      expect(fa.reservas[0]).toMatchObject({ primeraGratis: true, monto: 6966 });
      expect(fa.pagos[0]).toMatchObject({ concepto: "membresia_y_reserva", monto: 33666 });

      const fb = await filasDe(b.id);
      expect(fb.reservas[0]).toMatchObject({ primeraGratis: false, monto: 17415, precioLista: 19350 });
      expect(Number(fb.reservas[0].horasGratisAplicadas)).toBe(0);
      expect(fb.pagos[0]).toMatchObject({ concepto: "membresia_y_reserva", monto: 26700 + 17415 });
      expect(fb.reservas[0].direccionNormalizada).toBe(fa.reservas[0].direccionNormalizada);
    });

    it("dos departamentos distintos del mismo edificio reciben gratis cada uno", async () => {
      const [a, b] = await esc.crearClientes(2);
      const numero = numeroNuevo();
      await crear(a, cuerpo(nuevoDia(), { calle: "Av. Larco", numero, departamento: "Dpto 302" }));
      await crear(b, cuerpo(nuevoDia(), { calle: "Av. Larco", numero, departamento: "Dpto 401" }));
      expect((await filasDe(a.id)).reservas[0].primeraGratis).toBe(true);
      expect((await filasDe(b.id)).reservas[0].primeraGratis).toBe(true);
    });

    it("el mismo edificio sin departamento frente a uno con departamento recibe gratis", async () => {
      const [a, b] = await esc.crearClientes(2);
      const numero = numeroNuevo();
      await crear(a, cuerpo(nuevoDia(), { calle: "Av. Larco", numero }));
      await crear(b, cuerpo(nuevoDia(), { calle: "Av. Larco", numero, departamento: "302" }));
      expect((await filasDe(a.id)).reservas[0].primeraGratis).toBe(true);
      expect((await filasDe(b.id)).reservas[0].primeraGratis).toBe(true);
    });

    it("un cliente con una reserva confirmada en un hogar no recibe gratis en otro", async () => {
      const [cliente] = await esc.crearClientes(1);
      const [d] = await esc.crearDuenos(1);
      await sembrar(d, hogarDe(numeroNuevo()), { usuarioId: cliente.id, primeraGratis: false });
      await crear(cliente, cuerpo(nuevoDia(), { calle: "Av. Larco", numero: numeroNuevo() }));
      expect((await filasDe(cliente.id)).reservas.find((r) => r.estado === "pendiente")).toMatchObject({ primeraGratis: false, monto: 17415 });
    });

    it("un hogar que solo tiene reservas pagadas sí recibe gratis", async () => {
      const [cliente] = await esc.crearClientes(1);
      const numero = numeroNuevo();
      await sembrar(duenos[3], hogarDe(numero), { primeraGratis: false });
      await crear(cliente, cuerpo(nuevoDia(), { calle: "Av. Larco", numero }));
      expect((await filasDe(cliente.id)).reservas[0]).toMatchObject({ primeraGratis: true, monto: 6966 });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  // 3. Concurrencia (una barrera deja que todas las peticiones decidan antes de que alguna inserte)
  // ---------------------------------------------------------------------------------------------------------------
  describe("peticiones simultáneas", () => {
    // Detiene el primer insert de cada transacción hasta que lleguen `partes`; así todas han decidido gratis = verdadero.
    // Si alguna no llega (otro error antes), se libera a los 8 s.
    function barrera(partes: number) {
      let llegadas = 0;
      let liberar!: () => void;
      const abierta = new Promise<void>((r) => (liberar = r));
      const temporizador = setTimeout(liberar, 8_000);
      return async () => {
        if (++llegadas >= partes) {
          clearTimeout(temporizador);
          liberar();
        }
        await abierta;
      };
    }
    // Base cuya transacción espera la barrera antes del primer insert del callback.
    function baseConBarrera(esperar: () => Promise<void>, fallarDespues = false) {
      return {
        transaction: <T>(fn: (tx: Tx) => Promise<T>) =>
          base.transaction(async (tx) => {
            let primera = true;
            const proxy = new Proxy(tx, {
              get(objetivo, propiedad) {
                const valor = Reflect.get(objetivo, propiedad) as unknown;
                if (propiedad !== "insert") return typeof valor === "function" ? (valor as (...a: unknown[]) => unknown).bind(objetivo) : valor;
                return (tabla: Parameters<Tx["insert"]>[0]) => {
                  const constructor = objetivo.insert(tabla);
                  return {
                    values: (v: never) => {
                      const consulta = constructor.values(v);
                      return {
                        returning: async (...a: never[]) => {
                          if (primera) {
                            primera = false;
                            await esperar();
                          }
                          return (consulta.returning as (...x: never[]) => Promise<unknown>)(...a);
                        },
                      };
                    },
                  };
                };
              },
            });
            const resultado = await fn(proxy as Tx);
            if (fallarDespues) throw new Error("falla antes del commit");
            return resultado;
          }),
      };
    }

    const gratisDe = async (ids: string[]) => {
      const todas = await base.select().from(reservas).where(inArray(reservas.usuarioId, ids));
      return todas.filter((r) => r.primeraGratis);
    };

    it("dos cuentas, mismo hogar, días distintos: una gratis y la otra 409 limpieza_gratis_usada sin rastro", async () => {
      const [a, b] = await esc.crearClientes(2);
      const numero = numeroNuevo();
      const espera = barrera(2);
      const base2 = () => baseConBarrera(espera);
      const [ra, rb] = await Promise.allSettled([
        crear(a, cuerpo(nuevoDia(), { calle: "Av. Larco", numero }), dosEquipos(), base2),
        crear(b, cuerpo(nuevoDia(), { calle: "Av. Larco", numero }), dosEquipos(), base2),
      ]);
      const resultados = [ra, rb];
      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const perdedora = resultados.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
      expect(perdedora.reason).toMatchObject({ status: 409, codigo: "limpieza_gratis_usada", message: MENSAJE_GRATIS_DEL_HOGAR_USADA });
      expect((await gratisDe([a.id, b.id])).filter((r) => r.estado === "pendiente")).toHaveLength(1);
      const totales = [await totalDe(a.id), await totalDe(b.id)].sort();
      expect(totales).toEqual([0, 3]);
    });

    it("sin barrera (carrera natural) nunca hay dos gratis y el rechazo siempre es limpieza_gratis_usada", async () => {
      let rechazos = 0;
      for (let ronda = 0; ronda < 4; ronda++) {
        const [a, b] = await esc.crearClientes(2);
        const numero = numeroNuevo();
        const rs = await Promise.allSettled([
          crear(a, cuerpo(nuevoDia(), { calle: "Av. Larco", numero })),
          crear(b, cuerpo(nuevoDia(), { calle: "Av. Larco", numero })),
        ]);
        expect((await gratisDe([a.id, b.id])).filter((r) => r.estado === "pendiente")).toHaveLength(1);
        for (const r of rs) {
          if (r.status === "rejected") {
            rechazos++;
            expect(r.reason).toMatchObject({ status: 409, codigo: "limpieza_gratis_usada" });
          }
        }
      }
      console.log(`[gratis-por-hogar] carrera natural: ${rechazos} de 4 rondas terminaron con 409 limpieza_gratis_usada`);
    });

    it("diez cuentas por el mismo hogar: exactamente una gratis y nueve 409", async () => {
      const clientes = await esc.crearClientes(10);
      const numero = numeroNuevo();
      const espera = barrera(10);
      const resultados = await Promise.allSettled(
        clientes.map((c) => crear(c, cuerpo(nuevoDia(), { calle: "Av. Larco", numero }), dosEquipos(), () => baseConBarrera(espera))),
      );
      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of resultados) if (r.status === "rejected") expect(r.reason).toMatchObject({ status: 409, codigo: "limpieza_gratis_usada" });
      expect(await gratisDe(clientes.map((c) => c.id))).toHaveLength(1);
      const totales = await Promise.all(clientes.map((c) => totalDe(c.id)));
      expect(totales.filter((t) => t === 3)).toHaveLength(1);
      expect(totales.filter((t) => t === 0)).toHaveLength(9);
    });

    it("si la petición que iba ganando se deshace antes del commit, la otra se guarda con las horas gratis", async () => {
      const [a, b] = await esc.crearClientes(2);
      const numero = numeroNuevo();
      const espera = barrera(2);
      const [ra, rb] = await Promise.allSettled([
        crear(a, cuerpo(nuevoDia(), { calle: "Av. Larco", numero }), dosEquipos(), () => baseConBarrera(espera, true)),
        crear(b, cuerpo(nuevoDia(), { calle: "Av. Larco", numero }), dosEquipos(), () => baseConBarrera(espera)),
      ]);
      expect(ra.status).toBe("rejected");
      expect(rb.status).toBe("fulfilled");
      expect(await totalDe(a.id)).toBe(0);
      expect((await filasDe(b.id)).reservas[0]).toMatchObject({ primeraGratis: true, monto: 6966 });
    });

    it("mismo hogar y mismo horario con un solo equipo: pierde con 409 (se registra qué error informó Postgres)", async () => {
      const [a, b] = await esc.crearClientes(2);
      const numero = numeroNuevo();
      const dia = nuevoDia();
      const un = [esc.equipoIds[1]];
      const espera = barrera(2);
      const rs = await Promise.allSettled([
        crear(a, cuerpo(dia, { calle: "Av. Larco", numero }), un, () => baseConBarrera(espera)),
        crear(b, cuerpo(dia, { calle: "Av. Larco", numero }), un, () => baseConBarrera(espera)),
      ]);
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const perdedora = rs.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
      expect(perdedora.reason).toMatchObject({ status: 409 });
      expect(["conflicto", "limpieza_gratis_usada"]).toContain((perdedora.reason as ErrorApi).codigo);
      console.log(`[gratis-por-hogar] mismo hogar y horario: Postgres informó ${(perdedora.reason as ErrorApi).codigo}`);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  // 4. Reservas vencidas (hallazgo del 9a)
  // ---------------------------------------------------------------------------------------------------------------
  describe("reservas vencidas", () => {
    it("una gratis pendiente vencida de otra cuenta no impide la gratis y queda expirada", async () => {
      const [cliente] = await esc.crearClientes(1);
      const numero = numeroNuevo();
      const vencida = await sembrar(duenos[4], hogarDe(numero), { estado: "pendiente", expiraEn: new Date(Date.now() - 3_600_000) });
      await crear(cliente, cuerpo(nuevoDia(), { calle: "Av. Larco", numero }));
      expect((await filasDe(cliente.id)).reservas[0]).toMatchObject({ primeraGratis: true, monto: 6966 });
      expect(await estadoDe(vencida)).toBe("expirada");
    });

    it("un 409 que deshace la marca deja la vencida pendiente y la siguiente escritura la marca y concede las horas gratis", async () => {
      const [y, z] = await esc.crearClientes(2);
      const numero = numeroNuevo();
      // Y tiene su membresía pendiente y una reserva en otro hogar; vencida su reserva, su siguiente intento falla con 409.
      await crear(y, cuerpo(nuevoDia(), { calle: "Av. Larco", numero: numeroNuevo() }));
      await base.update(reservas).set({ expiraEn: new Date(Date.now() - 3_600_000) }).where(eq(reservas.usuarioId, y.id));
      // La vencida de otra cuenta se siembra después de la primera escritura de Y, que habría marcado cualquier vencida anterior.
      const vencidaDeOtra = await sembrar(duenos[5], hogarDe(numero), { estado: "pendiente", expiraEn: new Date(Date.now() - 3_600_000) });
      const e = await error(crear(y, cuerpo(nuevoDia(), { calle: "Av. Larco", numero: numeroNuevo() })));
      expect(e).toMatchObject({ status: 409, codigo: "en_espera", message: MENSAJE_MEMBRESIA_EN_REVISION });
      expect(await estadoDe(vencidaDeOtra)).toBe("pendiente");

      await crear(z, cuerpo(nuevoDia(), { calle: "Av. Larco", numero }));
      expect((await filasDe(z.id)).reservas[0]).toMatchObject({ primeraGratis: true, monto: 6966 });
      expect(await estadoDe(vencidaDeOtra)).toBe("expirada");
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  // 5. Reuso tras cancelar o expirar
  // ---------------------------------------------------------------------------------------------------------------
  describe("reuso tras cancelar o expirar", () => {
    it.each(["cancelada", "expirada"] as const)("al quedar %s la gratis del hogar, otra cuenta la recibe", async (estado) => {
      const [a, b] = await esc.crearClientes(2);
      const numero = numeroNuevo();
      await crear(a, cuerpo(nuevoDia(), { calle: "Av. Larco", numero }));
      await base.update(reservas).set({ estado }).where(eq(reservas.usuarioId, a.id));
      await crear(b, cuerpo(nuevoDia(), { calle: "Av. Larco", numero }));
      expect((await filasDe(b.id)).reservas[0]).toMatchObject({ primeraGratis: true, monto: 6966 });
    });

    it("al cancelar la reserva del cliente, su siguiente reserva (en otro hogar) vuelve a recibir la gratis", async () => {
      const [a] = await esc.crearClientes(1);
      await crear(a, cuerpo(nuevoDia(), { calle: "Av. Larco", numero: numeroNuevo() }));
      const hogarNuevo = { distrito: "Miraflores" as const, direccionNormalizada: `avenida larco ${numeroNuevo()}`, departamentoNormalizado: "" };
      expect(await decidirLimpiezaGratis(base, a.id, hogarNuevo)).toBe(false);
      await base.update(reservas).set({ estado: "cancelada" }).where(eq(reservas.usuarioId, a.id));
      expect(await decidirLimpiezaGratis(base, a.id, hogarNuevo)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  // 6. La cotización lee con la misma regla y no escribe
  // ---------------------------------------------------------------------------------------------------------------
  describe("GET /api/cotizacion con la dirección", () => {
    const usuario: Usuario = { id: "consulta", correo: "consulta@tiza.test", nombre: "Consulta", celular: "900000000", rol: "cliente" };
    const get = (clienteId: string) =>
      crearRutaCotizacion({
        sesion: async () => ({ ...usuario, id: clienteId }),
        leerConfig: async () => VALORES_DEL_DISENO,
        decidir: (u, h) => motivoSinGratis(base, u, h),
        // Sin esto la ruta leería la membresía con `db()`, que es la base de producción: todo va a la rama de pruebas.
        leerMembresia: (u) => leerMembresiaQueAutoriza(base, u),
        credito: (u, h) => creditoParaReserva(base, u, h),
        ahora: () => AHORA,
        esperaReintentoMs: 1,
      });
    const consulta = async (clienteId: string, numero: string) => {
      const url = `http://localhost/api/cotizacion?tipo=profunda&dormitorios=2&banos=1&distrito=Miraflores&calle=Av.%20Larco&numero=${numero}`;
      return (await get(clienteId)(new Request(url))).json();
    };

    it("con una gratis pendiente vigente en el hogar da motivo hogar y el precio completo", async () => {
      const [cliente] = await esc.crearClientes(1);
      const numero = numeroNuevo();
      await sembrar(duenos[6], hogarDe(numero), { estado: "pendiente" });
      expect(await consulta(cliente.id, numero)).toMatchObject({ aplica_gratis: false, motivo_sin_gratis: "hogar", monto: 17415, total_a_pagar: 44115 });
    });

    it("con la gratis cancelada, expirada o vencida sin marcar el hogar vuelve a aplicar, y no escribe", async () => {
      const [cliente] = await esc.crearClientes(1);
      const numeroCancelada = numeroNuevo();
      const numeroExpirada = numeroNuevo();
      const numeroVencida = numeroNuevo();
      await sembrar(duenos[7], hogarDe(numeroCancelada), { estado: "cancelada" });
      const [d1, d2] = await esc.crearDuenos(2);
      await sembrar(d1, hogarDe(numeroExpirada), { estado: "expirada" });
      const vencida = await sembrar(d2, hogarDe(numeroVencida), { estado: "pendiente", expiraEn: new Date(Date.now() - 3_600_000) });
      for (const n of [numeroCancelada, numeroExpirada, numeroVencida]) {
        expect(await consulta(cliente.id, n)).toMatchObject({ aplica_gratis: true, motivo_sin_gratis: null, total_a_pagar: 33666 });
      }
      expect(await estadoDe(vencida)).toBe("pendiente");
    });

    it("un cliente con una reserva viva recibe motivo cliente", async () => {
      const [cliente] = await esc.crearClientes(1);
      const [d] = await esc.crearDuenos(1);
      await sembrar(d, hogarDe(numeroNuevo()), { usuarioId: cliente.id, primeraGratis: false });
      expect(await consulta(cliente.id, numeroNuevo())).toMatchObject({ aplica_gratis: false, motivo_sin_gratis: "cliente" });
    });
  });
});
