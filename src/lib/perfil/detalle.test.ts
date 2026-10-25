import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { ErrorApi } from "../errores";
import { crearBdDoble, type Guion } from "./__dobles__/bd-doble";
import { leerDetalleReserva, MENSAJE_RESERVA_NO_ENCONTRADA, type DependenciasDetalle } from "./detalle";
import type { FilaVista } from "./reservas";

const AHORA = new Date("2026-11-02T15:00:00Z");
const enHoras = (h: number) => new Date(AHORA.getTime() + h * 3_600_000);
const ID = "11111111-1111-4111-8111-111111111111";

const fila = (extra: Partial<FilaVista & { pagoId: string }> = {}) => ({
  id: ID,
  pagoId: "pago-1",
  estado: "confirmada" as const,
  tipo: "profunda" as const,
  dormitorios: 2,
  banos: 1,
  horasTrabajo: "5.0",
  requiereApoyo: false,
  distrito: "Miraflores",
  calle: "Av. Larco",
  numero: "123",
  departamento: "501",
  referencias: "Frente al parque",
  inicio: enHoras(24 * 5),
  fin: enHoras(24 * 5 + 5),
  precioLista: 19350,
  horasGratisAplicadas: "3.0",
  monto: 6966,
  expiraEn: null,
  vencida: false,
  yaEmpezo: false,
  ...extra,
});
const pago = { id: "pago-1", concepto: "membresia_y_reserva", monto: 33666, metodo: "yape", estado: "aprobado", motivoRechazo: null, comprobanteRuta: "comprobantes/u1/a.jpg" };

function armar(guion: Guion) {
  const doble = crearBdDoble(guion);
  const dependencias: DependenciasDetalle = { base: () => doble.base, leerConfig: async () => VALORES_DEL_DISENO };
  return { doble, dependencias };
}
const leer = (reservaId: string, dependencias: DependenciasDetalle, usuarioId = "u1") =>
  leerDetalleReserva({ usuario: { id: usuarioId }, reservaId, ahora: AHORA }, dependencias);

describe("leerDetalleReserva", () => {
  it("reserva propia: servicio, dirección, horario, precio, horas gratis y estado del pago", async () => {
    const { dependencias } = armar({ reservas: [[fila()]], pagos: [[pago]] });
    const d = await leer(ID, dependencias);
    expect(d).toMatchObject({
      id: ID,
      estado: "confirmada",
      servicio: { tipo: "profunda", dormitorios: 2, banos: 1 },
      direccion: { calle: "Av. Larco", numero: "123", departamento: "501", referencias: "Frente al parque" },
      monto: 6966,
      precio_lista: 19350,
      horas_gratis_aplicadas: 3,
      puede_reprogramar: true,
      puede_cancelar: true,
      pago: { concepto: "membresia_y_reserva", monto: 33666, metodo: "yape", estado: "aprobado", motivo_rechazo: null, comprobante: "/api/comprobantes/pago-1" },
    });
  });

  it("la consulta lleva el dueño en el mismo WHERE que el id, también la del pago", async () => {
    const { doble, dependencias } = armar({ reservas: [[fila()]], pagos: [[pago]] });
    await leer(ID, dependencias, "usuario-A");
    const [res, pag] = doble.lecturas();
    expect(res.donde?.sql).toMatch(/"id" = \$\d+ and "reservas"\."usuario_id" = \$\d+|"usuario_id" = \$\d+/);
    expect(res.donde?.params).toEqual(expect.arrayContaining([ID, "usuario-A"]));
    expect(pag.donde?.params).toContain("usuario-A");
  });

  it("reserva de otro cliente o inexistente: 404 con el mismo mensaje", async () => {
    const { dependencias } = armar({ reservas: [[]] });
    const error = await leer(ID, dependencias).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error).toMatchObject({ status: 404, message: MENSAJE_RESERVA_NO_ENCONTRADA });
  });

  it("id sin formato de uuid: 404 sin consultar la base", async () => {
    const { doble, dependencias } = armar({});
    const error = await leer("abc", dependencias).catch((e) => e);
    expect(error).toMatchObject({ status: 404, message: MENSAJE_RESERVA_NO_ENCONTRADA });
    expect(doble.lecturas()).toHaveLength(0);
  });

  it("un administrador que no es el dueño recibe 404: el filtro es solo por el id de la sesión", async () => {
    const { doble, dependencias } = armar({ reservas: [[]] });
    const error = await leerDetalleReserva({ usuario: { id: "admin-1" }, reservaId: ID, ahora: AHORA }, dependencias).catch((e) => e);
    expect(error.status).toBe(404);
    expect(doble.lecturas()[0].donde?.params).toContain("admin-1");
  });

  it("no incluye equipo_id", async () => {
    const { dependencias } = armar({ reservas: [[{ ...fila(), equipoId: 2 }]], pagos: [[pago]] });
    expect(JSON.stringify(await leer(ID, dependencias))).not.toMatch(/equipo/i);
  });

  it("a menos de 24 horas no se puede cambiar; una cancelada o completada tampoco", async () => {
    for (const extra of [{ inicio: enHoras(23) }, { estado: "cancelada" as const }, { estado: "completada" as const }]) {
      const { dependencias } = armar({ reservas: [[fila(extra)]], pagos: [[pago]] });
      const d = await leer(ID, dependencias);
      expect(d.puede_cancelar).toBe(false);
      expect(d.puede_reprogramar).toBe(false);
    }
  });

  it("pago rechazado con motivo; sin comprobante no hay enlace", async () => {
    const { dependencias } = armar({ reservas: [[fila({ estado: "pendiente", expiraEn: enHoras(10) })]], pagos: [[{ ...pago, estado: "rechazado", motivoRechazo: "Borroso", comprobanteRuta: null }]] });
    const d = await leer(ID, dependencias);
    expect(d.pago).toMatchObject({ estado: "rechazado", motivo_rechazo: "Borroso", comprobante: null });
    expect(d.estado_texto).toBe("Esperando la aprobación de tu pago");
  });
});
