import { beforeEach, describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { consultarDisponibilidad } from "../agenda/consulta";
import { instanteLocal } from "../agenda/horario";
import { crearRutaDisponibilidad } from "../agenda/rutas";
import { ErrorApi } from "../errores";
import type { FilaMembresia, PagoReenviable } from "../perfil/membresia";
import type { MembresiaQueAutoriza } from "../reservas/membresia-vigente";
import { aErrorApi, comprobarVigenciaDeLaConsulta, comprobarVigenciaParaReservar } from "./vigencia-miembro";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

// Las tres lecturas del guard se sustituyen por dobles controlables; la comparación `inicio < fin` NO se sustituye: es la real de #13.
const estado = vi.hoisted(() => ({
  autoriza: null as unknown,
  filas: [] as unknown[],
  reenviables: [] as unknown[],
  usuarios: [] as string[],
}));
vi.mock("../reservas/membresia-vigente", () => ({
  leerMembresiaQueAutoriza: async (_b: unknown, usuarioId: string) => {
    estado.usuarios.push(usuarioId);
    return estado.autoriza;
  },
}));
vi.mock("../perfil/membresia", () => ({ leerMembresiaDelCliente: async () => estado.filas }));
vi.mock("../pagos/reenvio-plazo", () => ({ pagosRechazadosReenviables: async () => estado.reenviables }));

const ZONA = "America/Lima";
const AHORA = instanteLocal("2026-12-10", "10:00", ZONA);
const FIN = new Date("2026-12-30T15:00:00Z");
const CONFIG = { horario_atencion: VALORES_DEL_DISENO.horario_atencion, reenvio_comprobante_dias: 7 };
const BASE = {} as never;

const membresia = (extra: Partial<MembresiaQueAutoriza> = {}): MembresiaQueAutoriza => ({ id: "m1", inicio: new Date("2026-10-01T15:00:00Z"), fin: FIN, vigente: true, ...extra });
const pendiente = (estadoPago: "pendiente" | "rechazado" | null): FilaMembresia => ({
  id: "m-pend",
  estado: "pendiente",
  inicio: null,
  fin: null,
  vigente: false,
  segundosRestantes: null,
  ultimoPago: estadoPago ? { id: "p1", estado: estadoPago } : null,
});
const reenviable: PagoReenviable = { pagoId: "p1", reenvioHasta: new Date("2026-12-14T15:00:00Z"), motivoRechazo: null };

beforeEach(() => {
  estado.autoriza = null;
  estado.filas = [];
  estado.reenviables = [];
  estado.usuarios = [];
});

describe("comprobarVigenciaParaReservar", () => {
  it("dentro de la vigencia: ok con el fin", async () => {
    estado.autoriza = membresia();
    expect(await comprobarVigenciaParaReservar(BASE, "u1", new Date("2026-12-20T15:00:00Z"), CONFIG)).toEqual({ tipo: "ok", fin: FIN });
  });

  it("servicio posterior al fin: fuera_de_vigencia", async () => {
    estado.autoriza = membresia();
    expect(await comprobarVigenciaParaReservar(BASE, "u1", new Date("2027-01-02T15:00:00Z"), CONFIG)).toEqual({ tipo: "fuera_de_vigencia", fin: FIN });
  });

  it("servicio justo en el fin: fuera_de_vigencia (debe empezar antes)", async () => {
    estado.autoriza = membresia();
    expect((await comprobarVigenciaParaReservar(BASE, "u1", FIN, CONFIG)).tipo).toBe("fuera_de_vigencia");
    expect((await comprobarVigenciaParaReservar(BASE, "u1", new Date(FIN.getTime() - 1), CONFIG)).tipo).toBe("ok");
  });

  it("sin ninguna membresía activa: sin_membresia", async () => {
    expect(await comprobarVigenciaParaReservar(BASE, "u1", AHORA, CONFIG)).toEqual({ tipo: "sin_membresia" });
  });

  it("membresía vencida sin renovación: membresia_vencida", async () => {
    estado.autoriza = membresia({ vigente: false });
    expect(await comprobarVigenciaParaReservar(BASE, "u1", AHORA, CONFIG)).toEqual({ tipo: "membresia_vencida", fin: FIN });
  });

  it("vencida con la renovación pendiente de revisión: renovacion_en_revision", async () => {
    estado.autoriza = membresia({ vigente: false });
    estado.filas = [pendiente("pendiente")];
    expect((await comprobarVigenciaParaReservar(BASE, "u1", AHORA, CONFIG)).tipo).toBe("renovacion_en_revision");
  });

  it("vencida con la renovación rechazada dentro del plazo: renovacion_en_revision", async () => {
    estado.autoriza = membresia({ vigente: false });
    estado.filas = [pendiente("rechazado")];
    estado.reenviables = [reenviable];
    expect((await comprobarVigenciaParaReservar(BASE, "u1", AHORA, CONFIG)).tipo).toBe("renovacion_en_revision");
  });

  it("vencida con la rechazada fuera del plazo: vuelve a membresia_vencida", async () => {
    estado.autoriza = membresia({ vigente: false });
    estado.filas = [pendiente("rechazado")];
    expect((await comprobarVigenciaParaReservar(BASE, "u1", AHORA, CONFIG)).tipo).toBe("membresia_vencida");
  });

  it("el saldo de crédito en horas no levanta el bloqueo: el guard no lee créditos", async () => {
    // Con la membresía vencida el resultado no depende de ningún dato de crédito: no hay lectura que lo cambie.
    estado.autoriza = membresia({ vigente: false });
    expect((await comprobarVigenciaParaReservar(BASE, "u1", AHORA, CONFIG)).tipo).toBe("membresia_vencida");
    expect(estado.usuarios).toEqual(["u1"]);
  });

  it("no tiene su propia comparación de fechas: usa la de la reserva de miembro", async () => {
    const { readFileSync } = await import("node:fs");
    const fuente = readFileSync(new URL("./vigencia-miembro.ts", import.meta.url), "utf8");
    expect(fuente).toContain("validarVigenciaDeMembresia(");
    expect(fuente).not.toMatch(/inicioServicio\s*[<>]/);
    expect(fuente).not.toContain("creditosHoras");
    expect(fuente).not.toContain("@/db/esquema");
  });
});

describe("aErrorApi", () => {
  const fin = new Date("2026-12-30T15:00:00Z");
  it("ok y sin_membresia no son error", () => {
    expect(aErrorApi({ tipo: "ok", fin }, ZONA)).toBeNull();
    expect(aErrorApi({ tipo: "sin_membresia" }, ZONA)).toBeNull();
  });

  it("membresia_vencida: 409 con la fecha en hora de Lima", () => {
    expect(aErrorApi({ tipo: "membresia_vencida", fin }, ZONA)).toMatchObject({ status: 409, codigo: "membresia_vencida", message: "Tu membresía venció el 30 de diciembre de 2026. Realiza un nuevo pago para seguir reservando." });
  });

  it("renovacion_en_revision: 409", () => {
    expect(aErrorApi({ tipo: "renovacion_en_revision", fin }, ZONA)).toMatchObject({
      status: 409,
      codigo: "renovacion_en_revision",
      message: "Tu pago de renovación está en revisión. Cuando se apruebe, podrás elegir día y hora.",
    });
  });

  it("fuera_de_vigencia: 422 que menciona renovar", () => {
    const e = aErrorApi({ tipo: "fuera_de_vigencia", fin }, ZONA);
    expect(e).toMatchObject({ status: 422, codigo: "fuera_de_vigencia" });
    expect(e?.message).toBe("Tu membresía vence el 30 de diciembre de 2026. Elige una fecha anterior o renueva cuando venza.");
  });

  it("la fecha sale en hora de Lima, no en UTC (1 de enero 01:00 UTC es 31 de diciembre en Lima)", () => {
    expect(aErrorApi({ tipo: "membresia_vencida", fin: new Date("2027-01-01T01:00:00Z") }, ZONA)?.message).toContain("31 de diciembre de 2026");
  });
});

describe("comprobarVigenciaDeLaConsulta", () => {
  it("rechaza el día completo que cae en o después del fin (primera hora de atención >= fin)", async () => {
    estado.autoriza = membresia({ fin: instanteLocal("2026-12-21", "08:00", ZONA) });
    await expect(comprobarVigenciaDeLaConsulta({ base: BASE, usuarioId: "u1", fecha: "2026-12-21", config: CONFIG })).rejects.toMatchObject({ status: 422, codigo: "fuera_de_vigencia" });
    await expect(comprobarVigenciaDeLaConsulta({ base: BASE, usuarioId: "u1", fecha: "2026-12-22", config: CONFIG })).rejects.toMatchObject({ codigo: "fuera_de_vigencia" });
  });

  it("un día que contiene el fin en mitad del horario sigue mostrando horarios (lo cierra la reserva)", async () => {
    estado.autoriza = membresia({ fin: instanteLocal("2026-12-21", "12:00", ZONA) });
    await expect(comprobarVigenciaDeLaConsulta({ base: BASE, usuarioId: "u1", fecha: "2026-12-21", config: CONFIG })).resolves.toBeUndefined();
  });

  it("una fecha inválida da el mismo 422 de siempre", async () => {
    await expect(comprobarVigenciaDeLaConsulta({ base: BASE, usuarioId: "u1", fecha: "mañana", config: CONFIG })).rejects.toMatchObject({ status: 422 });
  });
});

describe("GET /api/disponibilidad con el guard de vigencia", () => {
  const USUARIO = { id: "u1", correo: "u1@tiza.test", nombre: "Ana", celular: "987654321", rol: "cliente" as const };
  const leerOcupacion = async () => ({ equipos: [{ id: 1 }, { id: 2 }], ocupadas: [] as [] });
  const ruta = (conSesion = true) =>
    crearRutaDisponibilidad({
      sesion: async () => {
        if (!conSesion) throw ErrorApi.sinSesion();
        return USUARIO;
      },
      consultar: (args) => consultarDisponibilidad(args, { leerConfig: async () => VALORES_DEL_DISENO, leerOcupacion }),
      vigencia: (usuario, parametros) => comprobarVigenciaDeLaConsulta({ base: BASE, usuarioId: usuario.id, fecha: parametros.get("fecha"), config: CONFIG }),
      ahora: () => AHORA,
    });
  const pedir = (fecha: string, conSesion = true) => ruta(conSesion)(new Request(`http://localhost/api/disponibilidad?fecha=${fecha}&tipo=estandar&dormitorios=2&banos=1`));

  it("cliente nuevo sin membresía: recibe los horarios como siempre", async () => {
    const res = await pedir("2026-12-15");
    expect(res.status).toBe(200);
    expect((await res.json()).horarios.length).toBeGreaterThan(0);
  });

  it("membresía vigente y fecha anterior al fin: horarios", async () => {
    estado.autoriza = membresia();
    expect((await pedir("2026-12-15")).status).toBe(200);
  });

  it("membresía vigente y fecha 20 días después del fin: 422 fuera_de_vigencia", async () => {
    estado.autoriza = membresia({ fin: new Date(AHORA.getTime() + 10 * 86_400_000) });
    const res = await pedir("2026-12-30");
    expect(res.status).toBe(422);
    expect((await res.json()).error.codigo).toBe("fuera_de_vigencia");
  });

  it("vencida: 409 membresia_vencida y ningún horario, sea cual sea la fecha", async () => {
    estado.autoriza = membresia({ vigente: false, fin: new Date("2026-12-01T15:00:00Z") });
    const res = await pedir("2026-12-15");
    expect(res.status).toBe(409);
    const cuerpo = await res.json();
    expect(cuerpo.error.codigo).toBe("membresia_vencida");
    expect(cuerpo.horarios).toBeUndefined();
  });

  it("vencida con la renovación en revisión: 409 renovacion_en_revision", async () => {
    estado.autoriza = membresia({ vigente: false });
    estado.filas = [pendiente("pendiente")];
    const res = await pedir("2026-12-15");
    expect(res.status).toBe(409);
    expect((await res.json()).error.codigo).toBe("renovacion_en_revision");
  });

  it("aprobada la renovación (la membresía nueva está vigente): vuelven los horarios", async () => {
    estado.autoriza = membresia({ vigente: true, fin: new Date("2027-03-10T15:00:00Z") });
    expect((await pedir("2026-12-15")).status).toBe(200);
  });

  it("sin sesión: 401", async () => {
    expect((await pedir("2026-12-15", false)).status).toBe(401);
  });

  it("el guard consulta con el usuario de la sesión", async () => {
    await pedir("2026-12-15");
    expect(estado.usuarios).toEqual(["u1"]);
  });
});
