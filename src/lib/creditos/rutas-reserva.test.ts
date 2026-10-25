import { beforeEach, describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { instanteLocal } from "../agenda/horario";
import { crearMiembroDoble, type OpcionesMiembro } from "../reservas/__dobles__/miembro-doble";
import { crearReserva, type DependenciasReserva } from "../reservas/crear";
import { crearRutaReservas } from "../reservas/rutas";
import type { Usuario } from "../sesion";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

// POST /api/reservas de un miembro con crédito en horas, de la ruta al doble de la base (ítem 14, tarea 4.7).
const AHORA = instanteLocal("2026-11-02", "10:00", "America/Lima");
const FIN = instanteLocal("2027-01-20", "10:00", "America/Lima");
const USUARIO: Usuario = { id: "u1", correo: "u1@tiza.test", nombre: "María Pérez", celular: "987654321", rol: "cliente" };
const lote = (horas: number) => ({ id: "lote-1", venceEn: new Date("2027-01-01T00:00:00Z"), horasDisponibles: horas });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const peticion = (cambios: Record<string, unknown> = {}, sacar: string[] = []) => {
  const cuerpo: Record<string, unknown> = {
    servicio: { tipo: "estandar", dormitorios: 2, banos: 1 }, // 4 h, S/ 129
    inicio: "2026-11-07T10:00:00-05:00",
    direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123" },
    metodo: "yape",
    comprobante: "comprobantes/u1/recibo.jpg",
    ...cambios,
  };
  for (const clave of sacar) delete cuerpo[clave];
  return new Request("http://localhost/api/reservas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
};

function montar(opciones: OpcionesMiembro = {}, cortes = 0) {
  const doble = crearMiembroDoble({ membresia: { id: "m1", fin: FIN, vigente: true }, reservasVivas: true, ...opciones }, () => AHORA);
  let pendientes = cortes;
  const base = {
    transaction: async (fn: never) => {
      if (pendientes > 0) {
        pendientes--;
        throw Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("Connection terminated"), { code: "ECONNRESET" }) });
      }
      return (doble.base.transaction as (f: never) => Promise<unknown>)(fn);
    },
  };
  const deps: DependenciasReserva = {
    leerConfig: async () => VALORES_DEL_DISENO,
    verificarImagen: async () => ({ ruta: "comprobantes/u1/verificada.jpg", tipo: "image/jpeg" as const, tamano: 1000 }),
    base: () => base as never,
    numeroWhatsapp: () => "51912345678",
    esMiembro: async () => true,
  };
  const POST = crearRutaReservas({
    sesion: async () => USUARIO,
    crear: (entrada) => crearReserva(entrada, deps),
    ahora: () => AHORA,
    esperaReintentoMs: 1,
  });
  return { ...doble, POST };
}

describe("POST /api/reservas de un miembro con crédito", () => {
  it("201 cubierta: confirmada sin comprobante, monto 0 y usos consumido", async () => {
    const m = montar({ lotes: [lote(4)] });
    const r = await m.POST(peticion({}, ["comprobante", "metodo"]));
    expect(r.status).toBe(201);
    const json = await r.json();
    expect(json.reserva).toMatchObject({ estado: "confirmada", monto: 0, expira_en: null });
    expect(json.pago).toMatchObject({ metodo: "credito", estado: "aprobado", monto: 0 });
    expect(m.estado.usos).toEqual([expect.objectContaining({ horas: 4, estado: "consumido" })]);
  });

  it("201 parcial: pendiente con el monto de las horas por pagar y usos reservado", async () => {
    const m = montar({ lotes: [lote(2)] });
    const r = await m.POST(peticion());
    expect(r.status).toBe(201);
    const json = await r.json();
    expect(json.reserva).toMatchObject({ estado: "pendiente", monto: 5805 });
    expect(json.pago).toMatchObject({ estado: "pendiente", monto: 5805 });
    expect(m.estado.usos).toEqual([expect.objectContaining({ horas: 2, estado: "reservado" })]);
  });

  it("422 sin comprobante y con resto por pagar: deja los lotes intactos", async () => {
    const m = montar({ lotes: [lote(1)] });
    const r = await m.POST(peticion({}, ["comprobante"]));
    expect(r.status).toBe(422);
    expect((await r.json()).error.codigo).toBe("comprobante_requerido");
    expect(m.estado.descuentos).toEqual([]);
    expect(m.estado.usos).toEqual([]);
  });

  it("409 sin cupo: no descuenta nada", async () => {
    const m = montar({ lotes: [lote(4)], sinCupo: true });
    const r = await m.POST(peticion());
    expect(r.status).toBe(409);
    expect(m.estado.descuentos).toEqual([]);
    expect(m.estado.usos).toEqual([]);
  });

  it("un corte de conexión seguido de éxito reserva y descuenta una sola vez", async () => {
    const m = montar({ lotes: [lote(2)] }, 1);
    const r = await m.POST(peticion());
    expect(r.status).toBe(201);
    expect(m.estado.reservas).toHaveLength(1);
    expect(m.estado.usos).toHaveLength(1);
    expect(m.estado.descuentos).toEqual([{ creditoId: "lote-1", horas: 2 }]);
  });

  it("dos cortes dan 503 «Inténtalo en unos segundos.» sin descontar", async () => {
    const m = montar({ lotes: [lote(2)] }, 2);
    const r = await m.POST(peticion());
    expect(r.status).toBe(503);
    expect((await r.json()).error.mensaje).toBe("Inténtalo en unos segundos.");
    expect(m.estado.usos).toEqual([]);
    expect(m.estado.descuentos).toEqual([]);
  });
});
