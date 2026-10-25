import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { ErrorApi } from "../errores";
import { crearBdDoble, type Guion } from "./__dobles__/bd-doble";
import { leerDetalleReserva, type DependenciasDetalle } from "./detalle";
import { listarHistorial, type FilaVista } from "./reservas";

// Fotos del servicio en el perfil del cliente (ítem 17): el detalle y el conteo del historial.
const AHORA = new Date("2026-11-02T15:00:00Z");
const enHoras = (h: number) => new Date(AHORA.getTime() + h * 3_600_000);
const ID = "11111111-1111-4111-8111-111111111111";

const fila = (extra: Partial<FilaVista & { pagoId: string; totalFotos: number | string }> = {}) => ({
  id: ID,
  pagoId: "pago-1",
  estado: "completada" as const,
  tipo: "estandar" as const,
  dormitorios: 2,
  banos: 1,
  horasTrabajo: "4.0",
  requiereApoyo: false,
  distrito: "Miraflores",
  calle: "Av. Larco",
  numero: "123",
  departamento: null,
  referencias: null,
  inicio: enHoras(-24 * 3),
  fin: enHoras(-24 * 3 + 4),
  precioLista: 12900,
  horasGratisAplicadas: "0.0",
  monto: 11610,
  expiraEn: null,
  vencida: false,
  yaEmpezo: true,
  ...extra,
});
const pago = { id: "pago-1", concepto: "reserva", monto: 11610, metodo: "yape", estado: "aprobado", motivoRechazo: null, comprobanteRuta: null };

function armar(guion: Guion) {
  const doble = crearBdDoble(guion);
  const dependencias: DependenciasDetalle = { base: () => doble.base, leerConfig: async () => VALORES_DEL_DISENO };
  return { doble, dependencias };
}
const leer = (dependencias: DependenciasDetalle, reservaId = ID, usuarioId = "u1") =>
  leerDetalleReserva({ usuario: { id: usuarioId }, reservaId, ahora: AHORA }, dependencias);

describe("fotos en el detalle de la reserva", () => {
  it("reserva propia completada con fotos: id, ambiente y etiqueta, sin ruta ni URL de Blob", async () => {
    const { dependencias } = armar({
      reservas: [[fila()]],
      pagos: [[pago]],
      fotos_servicio: [[{ id: "f1", ambiente: "cocina" }, { id: "f2", ambiente: "bano" }, { id: "f3", ambiente: "cocina", ruta: "fotos/x/1.webp" }]],
    });
    const d = await leer(dependencias);
    expect(d.fotos).toEqual([
      { id: "f1", ambiente: "cocina", etiqueta: "Cocina" },
      { id: "f2", ambiente: "bano", etiqueta: "Baño" },
      { id: "f3", ambiente: "cocina", etiqueta: "Cocina" },
    ]);
    const json = JSON.stringify(d);
    expect(json).not.toContain("ruta");
    expect(json).not.toContain("fotos/x");
    expect(json).not.toMatch(/blob/i);
  });

  it("la consulta de fotos lleva el id de la reserva ya comprobada como del cliente", async () => {
    const { doble, dependencias } = armar({ reservas: [[fila()]], pagos: [[pago]], fotos_servicio: [[]] });
    await leer(dependencias, ID, "usuario-A");
    const lecturas = doble.lecturas();
    expect(lecturas.map((l) => l.tabla)).toEqual(["reservas", "pagos", "resenas", "fotos_servicio"]);
    expect(lecturas[0].donde?.params).toEqual(expect.arrayContaining([ID, "usuario-A"]));
    expect(lecturas[3].donde?.params).toEqual([ID]);
  });

  it("completada sin fotos: lista vacía", async () => {
    const { dependencias } = armar({ reservas: [[fila()]], pagos: [[pago]], fotos_servicio: [[]] });
    expect((await leer(dependencias)).fotos).toEqual([]);
  });

  it.each(["confirmada", "cancelada", "expirada"] as const)("reserva %s: sin fotos y ni siquiera se consulta la tabla", async (estado) => {
    const { doble, dependencias } = armar({
      reservas: [[fila({ estado, yaEmpezo: false, inicio: enHoras(24 * 5), fin: enHoras(24 * 5 + 4) })]],
      pagos: [[pago]],
      fotos_servicio: [[{ id: "f1", ambiente: "cocina" }]],
    });
    const d = await leer(dependencias);
    expect(d.fotos).toEqual([]);
    expect(doble.lecturas().some((l) => l.tabla === "fotos_servicio")).toBe(false);
  });

  it("reserva de otro cliente: 404 y no se consultó ninguna foto", async () => {
    const { doble, dependencias } = armar({ reservas: [[]], fotos_servicio: [[{ id: "ajena", ambiente: "sala" }]] });
    const error = await leer(dependencias, ID, "usuario-B").then(() => null, (e: ErrorApi) => e);
    expect(error?.status).toBe(404);
    expect(doble.lecturas().some((l) => l.tabla === "fotos_servicio")).toBe(false);
  });

  it("un id que no es uuid: 404 sin consultar nada", async () => {
    const { doble, dependencias } = armar({});
    const error = await leer(dependencias, "abc").then(() => null, (e: ErrorApi) => e);
    expect(error?.status).toBe(404);
    expect(doble.lecturas()).toEqual([]);
  });
});

describe("cantidad de fotos en el historial", () => {
  const config = { horario_atencion: VALORES_DEL_DISENO.horario_atencion };

  it("4 fotos → total_fotos 4; sin fotos → 0", async () => {
    const doble = crearBdDoble({ reservas: [[fila({ id: "a", totalFotos: 4 }), fila({ id: "b", totalFotos: 0 }), fila({ id: "c" })]] });
    const historial = await listarHistorial(doble.base, "u1", config);
    expect(historial.map((h) => h.total_fotos)).toEqual([4, 0, 0]);
  });

  it("el conteo llega como texto desde algunos controladores: se convierte en número", async () => {
    const doble = crearBdDoble({ reservas: [[fila({ totalFotos: "3" })]] });
    expect((await listarHistorial(doble.base, "u1", config))[0].total_fotos).toBe(3);
  });

  it("el conteo va en la misma consulta del historial, filtrada por el cliente, sin consultar la tabla de fotos aparte", async () => {
    const doble = crearBdDoble({ reservas: [[fila({ totalFotos: 2 })]] });
    await listarHistorial(doble.base, "usuario-A", config);
    const lecturas = doble.lecturas();
    expect(lecturas).toHaveLength(1);
    expect(lecturas[0].tabla).toBe("reservas");
    expect(lecturas[0].donde?.params).toContain("usuario-A");
  });
});
