import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { crearBdDoble, type Guion } from "../perfil/__dobles__/bd-doble";
import { leerDetalleReserva, type DependenciasDetalle } from "../perfil/detalle";
import { listarHistorial } from "../perfil/reservas";

const AHORA = new Date("2026-11-20T15:00:00Z");
const ID = "11111111-1111-4111-8111-111111111111";
const pasado = (dias: number) => new Date(AHORA.getTime() - dias * 86_400_000);

const fila = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  pagoId: "pago-1",
  estado: "completada",
  tipo: "estandar",
  dormitorios: 2,
  banos: 1,
  horasTrabajo: "4.0",
  requiereApoyo: false,
  distrito: "Miraflores",
  calle: "Av. Larco",
  numero: "123",
  departamento: null,
  referencias: null,
  inicio: pasado(5),
  fin: pasado(5),
  precioLista: 12900,
  horasGratisAplicadas: "0",
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
const leer = (dependencias: DependenciasDetalle, usuarioId = "u1", reservaId = ID) => leerDetalleReserva({ usuario: { id: usuarioId }, reservaId, ahora: AHORA }, dependencias);

describe("la reseña en el detalle de la reserva", () => {
  it("completada sin reseña: puede reseñar", async () => {
    const { dependencias } = armar({ reservas: [[fila()]], pagos: [[pago]], resenas: [[]] });
    const d = await leer(dependencias);
    expect(d.resena).toBeNull();
    expect(d.puede_resenar).toBe(true);
  });

  it.each(["pendiente", "aprobada", "rechazada"] as const)("con una reseña %s: la devuelve y ya no puede reseñar", async (estado) => {
    const { dependencias } = armar({ reservas: [[fila()]], pagos: [[pago]], resenas: [[{ estrellas: 4, comentario: "Todo muy bien, gracias.", estado }]] });
    const d = await leer(dependencias);
    expect(d.resena).toEqual({ estrellas: 4, comentario: "Todo muy bien, gracias.", estado });
    expect(d.puede_resenar).toBe(false);
  });

  it.each(["confirmada", "pendiente", "cancelada", "expirada"])("una reserva %s no puede reseñarse", async (estado) => {
    const { dependencias } = armar({ reservas: [[fila({ estado, inicio: pasado(-5), yaEmpezo: false })]], pagos: [[pago]], resenas: [[]] });
    const d = await leer(dependencias);
    expect(d.puede_resenar).toBe(false);
    expect(d.resena).toBeNull();
  });

  it("la reserva de otro cliente da 404 y NO consulta ninguna reseña", async () => {
    const { doble, dependencias } = armar({ reservas: [[]], resenas: [[{ estrellas: 1, comentario: "De B", estado: "aprobada" }]] });
    await expect(leer(dependencias, "u-a")).rejects.toMatchObject({ status: 404 });
    expect(doble.lecturas().some((s) => s.tabla === "resenas")).toBe(false);
  });

  it("la reseña se consulta por la reserva ya comprobada, después de la del dueño", async () => {
    const { doble, dependencias } = armar({ reservas: [[fila()]], pagos: [[pago]], resenas: [[]] });
    await leer(dependencias);
    const tablas = doble.lecturas().map((s) => s.tabla);
    expect(tablas[0]).toBe("reservas");
    expect(tablas).toContain("resenas");
    expect(doble.lecturas()[0].donde?.params).toEqual(expect.arrayContaining([ID, "u1"]));
  });

  it("ninguna respuesta trae quién revisó", async () => {
    const { dependencias } = armar({
      reservas: [[fila()]],
      pagos: [[pago]],
      resenas: [[{ estrellas: 5, comentario: "Excelente atención.", estado: "aprobada", revisadaPor: "admin-1", revisadaEn: new Date() }]],
    });
    expect(JSON.stringify(await leer(dependencias))).not.toMatch(/revisad/i);
  });
});

describe("la reseña en el historial", () => {
  it("cada elemento lleva resena_estado (null si no tiene) y la consulta va filtrada por el dueño", async () => {
    const doble = crearBdDoble({ reservas: [[fila({ id: "a", resenaEstado: null }), fila({ id: "b", resenaEstado: "pendiente" }), fila({ id: "c", resenaEstado: "aprobada" }), fila({ id: "d" })]] });
    const historial = await listarHistorial(doble.base, "u-a", VALORES_DEL_DISENO);
    expect(historial.map((h) => h.resena_estado)).toEqual([null, "pendiente", "aprobada", null]);
    expect(doble.lecturas()).toHaveLength(1);
    expect(doble.lecturas()[0].tabla).toBe("reservas");
    expect(doble.lecturas()[0].donde?.params).toContain("u-a");
  });

  it("no expone la reseña ni el revisor, solo su estado", async () => {
    const doble = crearBdDoble({ reservas: [[fila({ resenaEstado: "aprobada", comentario: "texto", revisadaPor: "admin-1" })]] });
    const [h] = await listarHistorial(doble.base, "u1", VALORES_DEL_DISENO);
    expect(JSON.stringify(h)).not.toMatch(/revisad|admin-1/);
    expect(h).not.toHaveProperty("resena");
  });
});
