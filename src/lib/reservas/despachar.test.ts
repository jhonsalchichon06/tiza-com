import { beforeEach, describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { instanteLocal } from "../agenda/horario";
import { ErrorApi } from "../errores";
import type { Usuario } from "../sesion";
import { crearBaseDoble, type Opciones } from "./__dobles__/base-doble";
import { crearMiembroDoble, type OpcionesMiembro } from "./__dobles__/miembro-doble";
import { crearReserva, MENSAJE_MEMBRESIA_EN_REVISION, MENSAJE_YA_ES_MIEMBRO, type DependenciasReserva } from "./crear";
import { crearRutaReservas } from "./rutas";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

const AHORA = instanteLocal("2026-11-02", "10:00", "America/Lima");
const USUARIO: Usuario = { id: "u1", correo: "u1@tiza.test", nombre: "María Pérez", celular: "987654321", rol: "cliente" };
const FIN = instanteLocal("2027-01-20", "10:00", "America/Lima");

const cuerpo = () => ({
  servicio: { tipo: "estandar", dormitorios: 2, banos: 1 },
  inicio: "2026-11-07T10:00:00-05:00",
  direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123" },
  metodo: "yape",
  comprobante: "comprobantes/u1/recibo.jpg",
});

function dependencias(base: DependenciasReserva["base"], esMiembro: (id: string) => Promise<boolean>): DependenciasReserva {
  return {
    leerConfig: async () => VALORES_DEL_DISENO,
    verificarImagen: async () => ({ ruta: "comprobantes/u1/verificada.jpg", tipo: "image/jpeg" as const, tamano: 1000 }),
    base,
    numeroWhatsapp: () => "51912345678",
    esMiembro,
  };
}

const conMiembro = (opciones: OpcionesMiembro = {}) => {
  const d = crearMiembroDoble({ membresia: { id: "m1", fin: FIN, vigente: true }, reservasVivas: true, ...opciones }, () => AHORA);
  return { ...d, deps: (esMiembro = async () => true) => dependencias(() => d.base, esMiembro) };
};
const conPrimera = (opciones: Opciones = {}) => {
  const d = crearBaseDoble(opciones, () => AHORA);
  return { ...d, deps: (esMiembro = async () => false) => dependencias(() => d.base, esMiembro) };
};

const crear = (deps: DependenciasReserva) => crearReserva({ usuario: USUARIO, cuerpo: cuerpo(), ahora: AHORA }, deps);
async function error(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("se esperaba un error");
}

describe("crearReserva (despachador)", () => {
  it("un miembro va por la rama de miembro: pago de reserva y sin membresía nueva", async () => {
    const m = conMiembro();
    const r = await crear(m.deps());
    expect(r.membresia).toBeNull();
    expect(r.pago.concepto).toBe("reserva");
    expect(m.estado.operaciones).not.toContain("insert:membresias");
  });

  it("sin membresía va por la rama de la primera: crea la membresía", async () => {
    const m = conPrimera();
    const r = await crear(m.deps());
    expect(r.membresia).toMatchObject({ estado: "pendiente", monto: 26700 });
    expect(m.estado.membresias).toHaveLength(1);
  });

  it("solo una membresía pendiente: rama de la primera con su 409", async () => {
    const m = conPrimera({ membresias: [{ id: "m1", estado: "pendiente" }], ultimoPago: { estado: "pendiente" } });
    expect(await error(crear(m.deps()))).toMatchObject({ status: 409, codigo: "en_espera", message: MENSAJE_MEMBRESIA_EN_REVISION });
    expect(m.estado.pagos).toHaveLength(0);
  });

  it("activa vencida: rama de miembro con el 422 de renovar", async () => {
    const m = conMiembro({ membresia: { id: "m1", fin: instanteLocal("2026-10-20", "10:00", "America/Lima"), vigente: false } });
    expect(await error(crear(m.deps()))).toMatchObject({ status: 422, message: expect.stringMatching(/renueva tu membresía/) });
    expect(m.estado.pagos).toHaveLength(0);
  });

  it("carrera: la membresía se activa tras decidir la rama → 409 en_espera y ninguna segunda membresía", async () => {
    const m = conPrimera({ membresias: [{ id: "m1", estado: "activa" }] });
    const e = await error(crear(m.deps(async () => false)));
    expect(e).toMatchObject({ status: 409, codigo: "en_espera", message: MENSAJE_YA_ES_MIEMBRO });
    expect(m.estado.membresias).toHaveLength(0);
  });

  it("lee la membresía del usuario de la sesión", async () => {
    const esMiembro = vi.fn(async () => true);
    await crear(conMiembro().deps(esMiembro));
    expect(esMiembro).toHaveBeenCalledWith("u1");
  });
});

describe("POST /api/reservas con el despachador", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const corte = () => Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" }) });
  const peticion = () =>
    new Request("http://localhost/api/reservas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo()) });
  const POST = (deps: DependenciasReserva) =>
    crearRutaReservas({ sesion: async () => USUARIO, crear: (entrada) => crearReserva(entrada, deps), ahora: () => AHORA, esperaReintentoMs: 1 });

  it("un miembro recibe 201 con membresia null", async () => {
    const r = await POST(conMiembro().deps())(peticion());
    expect(r.status).toBe(201);
    const json = await r.json();
    expect(json.membresia).toBeNull();
    expect(json.pago.concepto).toBe("reserva");
  });

  it("quien no es miembro recibe 201 con la membresía", async () => {
    const r = await POST(conPrimera().deps())(peticion());
    expect((await r.json()).membresia).toMatchObject({ estado: "pendiente" });
  });

  it("un corte de conexión seguido de éxito crea una sola vez", async () => {
    const m = conMiembro();
    let llamadas = 0;
    const deps = m.deps(async () => {
      if (llamadas++ === 0) throw corte();
      return true;
    });
    const r = await POST(deps)(peticion());
    expect(r.status).toBe(201);
    expect(m.estado.reservas).toHaveLength(1);
  });

  it("dos cortes dan 503 «Inténtalo en unos segundos.»", async () => {
    const r = await POST(conMiembro().deps(async () => { throw corte(); }))(peticion());
    expect(r.status).toBe(503);
    expect((await r.json()).error.mensaje).toBe("Inténtalo en unos segundos.");
  });

  it("el 422 de vigencia llega con el formato único", async () => {
    const vencida = conMiembro({ membresia: { id: "m1", fin: instanteLocal("2026-10-20", "10:00", "America/Lima"), vigente: false } });
    const r = await POST(vencida.deps())(peticion());
    expect(r.status).toBe(422);
    expect((await r.json()).error.mensaje).toMatch(/renueva tu membresía/);
  });

  it("el 409 horario_pendiente llega con su código", async () => {
    const m = conMiembro({ pagosSinHorario: [{ id: "p0" }], ultimasDePagos: [{ pagoId: "p0", estado: "expirada", canceladaPor: null }] });
    const r = await POST(m.deps())(peticion());
    expect(r.status).toBe(409);
    expect((await r.json()).error.codigo).toBe("horario_pendiente");
  });
});
