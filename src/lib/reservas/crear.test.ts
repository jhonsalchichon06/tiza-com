import { describe, expect, it, vi } from "vitest";
import { VALORES_DEL_DISENO } from "../__fixtures__/configuracion";
import { instanteLocal } from "../agenda/horario";
import { ErrorApi } from "../errores";
import type { AlmacenDeImagenes } from "../imagenes/almacen";
import { verificarImagenSubida } from "../imagenes/verificar";
import type { Usuario } from "../sesion";
import { crearBaseDoble, type Opciones } from "./__dobles__/base-doble";
import { crearPrimeraReserva, mensajePagoRechazado, MENSAJE_MEMBRESIA_EN_REVISION, MENSAJE_YA_ES_MIEMBRO, type DependenciasCrear } from "./crear";
import { MENSAJE_GRATIS_DEL_HOGAR_USADA, MENSAJE_PAGO_EN_REVISION, MENSAJE_RESERVA_EN_ESPERA } from "./unicidad";

const AHORA = instanteLocal("2026-11-02", "10:00", "America/Lima"); // lunes
const USUARIO: Usuario = { id: "u1", correo: "u1@tiza.test", nombre: "María Pérez", celular: "987654321", rol: "cliente" };
const RUTA_SUBIDA = "comprobantes/u1/recibo-abc.jpg";
const RUTA_VERIFICADA = "comprobantes/u1/verificada-xyz.jpg";
const WHATSAPP_EJEMPLO = "51912345678";

const cuerpo = (cambios: Record<string, unknown> = {}) => ({
  servicio: { tipo: "profunda", dormitorios: 2, banos: 1 },
  inicio: "2026-11-07T10:00:00-05:00", // sábado, 5 días después
  direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: "Dpto. 302" },
  metodo: "yape",
  comprobante: RUTA_SUBIDA,
  ...cambios,
});

function montar(opciones: Opciones = {}, extra: Partial<DependenciasCrear> = {}) {
  const doble = crearBaseDoble(opciones, () => AHORA);
  const verificarImagen = vi.fn(async () => ({ ruta: RUTA_VERIFICADA, tipo: "image/jpeg" as const, tamano: 1000 }));
  const dependencias: DependenciasCrear = {
    leerConfig: async () => VALORES_DEL_DISENO,
    verificarImagen,
    base: () => doble.base,
    equipoIds: undefined,
    numeroWhatsapp: () => WHATSAPP_EJEMPLO,
    ...extra,
  };
  const crear = (c: unknown = cuerpo(), ahora = AHORA) => crearPrimeraReserva({ usuario: USUARIO, cuerpo: c, ahora }, dependencias);
  return { ...doble, crear, verificarImagen, dependencias };
}

async function error(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("se esperaba un error");
}

describe("comprobante y método de pago", () => {
  it("sin comprobante → 422 y la transacción nunca se abre", async () => {
    const m = montar();
    const { comprobante: _c, ...sin } = cuerpo();
    expect(await error(m.crear(sin))).toMatchObject({ status: 422, message: expect.stringMatching(/comprobante/i) });
    expect(m.estado.transacciones).toBe(0);
    expect(m.verificarImagen).not.toHaveBeenCalled();
  });

  it.each(["tarjeta", "credito"])("método %s → 422 sin transacción", async (metodo) => {
    const m = montar();
    expect(await error(m.crear(cuerpo({ metodo })))).toMatchObject({ status: 422 });
    expect(m.estado.transacciones).toBe(0);
  });

  it("el archivo no existe → 404 sin transacción", async () => {
    const m = montar({}, { verificarImagen: async () => { throw ErrorApi.noEncontrado("No encontramos el archivo que subiste. Súbelo de nuevo."); } });
    expect(await error(m.crear())).toMatchObject({ status: 404 });
    expect(m.estado.transacciones).toBe(0);
  });

  describe("con la verificación real y un almacén doble", () => {
    const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const PDF = new TextEncoder().encode("%PDF-1.7 ....");
    const almacen = (inicio: Uint8Array | null, tamano = 1000): Pick<AlmacenDeImagenes, "metadatos" | "leerInicio"> => ({
      metadatos: async () => (inicio ? { tamano, tipoDeclarado: "image/png" } : null),
      leerInicio: async () => inicio,
    });
    const con = (a: ReturnType<typeof almacen>) =>
      montar({}, { verificarImagen: (entrada) => verificarImagenSubida(entrada as Parameters<typeof verificarImagenSubida>[0], a) });

    it("una ruta de la carpeta de otro usuario → error sin transacción", async () => {
      const m = con(almacen(PNG));
      const e = await error(m.crear(cuerpo({ comprobante: "comprobantes/otro-usuario/x.png" })));
      expect(e.status).toBe(422);
      expect(m.estado.transacciones).toBe(0);
    });

    it("un archivo que no es una imagen → 422 sin transacción", async () => {
      const m = con(almacen(PDF));
      const e = await error(m.crear(cuerpo({ comprobante: "comprobantes/u1/falso.png" })));
      expect(e).toMatchObject({ status: 422, message: expect.stringMatching(/JPG, PNG o WebP/) });
      expect(m.estado.transacciones).toBe(0);
    });

    it("un archivo que no existe en la tienda → 404 sin transacción", async () => {
      const m = con(almacen(null));
      expect(await error(m.crear(cuerpo({ comprobante: "comprobantes/u1/nada.png" })))).toMatchObject({ status: 404 });
      expect(m.estado.transacciones).toBe(0);
    });

    it("una verificación correcta crea la reserva", async () => {
      const m = con(almacen(PNG));
      await m.crear(cuerpo({ comprobante: "comprobantes/u1/bueno.png" }));
      expect(m.estado.pagos[0].comprobanteRuta).toBe("comprobantes/u1/bueno.png");
    });
  });

  it("guarda en el pago la ruta que devolvió la verificación y no la del cuerpo", async () => {
    const m = montar();
    await m.crear();
    expect(m.verificarImagen).toHaveBeenCalledWith({ ruta: RUTA_SUBIDA, usuario: { id: "u1", rol: "cliente" } });
    expect(m.estado.pagos[0].comprobanteRuta).toBe(RUTA_VERIFICADA);
    expect(JSON.stringify(m.estado.pagos)).not.toContain(RUTA_SUBIDA);
  });
});

describe("dirección", () => {
  const conDireccion = (direccion: Record<string, unknown>) => cuerpo({ direccion });

  it("un distrito fuera de los 9 → 422", async () => {
    const m = montar();
    expect(await error(m.crear(conDireccion({ distrito: "La Molina", calle: "Av. Larco", numero: "123" })))).toMatchObject({
      status: 422,
      message: expect.stringMatching(/distritos que atendemos/),
    });
    expect(m.estado.transacciones).toBe(0);
  });

  it("calle vacía → 422 pidiendo la calle", async () => {
    const m = montar();
    expect(await error(m.crear(conDireccion({ distrito: "Miraflores", calle: "  ", numero: "123" })))).toMatchObject({ status: 422, message: expect.stringMatching(/calle/i) });
    expect(m.estado.transacciones).toBe(0);
  });

  it("número «s/n» → 422 pidiendo un número con dígito", async () => {
    const m = montar();
    expect(await error(m.crear(conDireccion({ distrito: "Miraflores", calle: "Av. Larco", numero: "s/n" })))).toMatchObject({ status: 422, message: expect.stringMatching(/dígito/) });
    expect(m.estado.transacciones).toBe(0);
  });

  it("guarda lo escrito y lo normalizado", async () => {
    const m = montar();
    await m.crear();
    expect(m.estado.reservas[0]).toMatchObject({
      distrito: "Miraflores",
      calle: "Av. Larco",
      numero: "123",
      departamento: "Dpto. 302",
      direccionNormalizada: "avenida larco 123",
      departamentoNormalizado: "dpto 302",
    });
  });

  it("sin departamento ni referencias se crea con el departamento vacío", async () => {
    const m = montar();
    await m.crear(conDireccion({ distrito: "San Borja", calle: "Jr. Lima", numero: "45" }));
    expect(m.estado.reservas[0]).toMatchObject({ departamento: null, referencias: null, departamentoNormalizado: "" });
  });
});

describe("inicio y vigencia", () => {
  const conInicio = (inicio: string, servicio?: unknown) => cuerpo({ inicio, ...(servicio ? { servicio } : {}) });

  it.each([
    ["domingo", "2026-11-08T10:00:00-05:00", /Atendemos de lunes a sábado/],
    ["7:30 am", "2026-11-07T07:30:00-05:00", /horario de atención/],
    ["9:15 am (no es múltiplo de 30 minutos)", "2026-11-07T09:15:00-05:00", /cada 30 minutos/],
    ["sin zona horaria", "2026-11-07T10:00:00", /día y la hora/],
  ])("%s → 422", async (_n, inicio, mensaje) => {
    const m = montar();
    expect(await error(m.crear(conInicio(inicio)))).toMatchObject({ status: 422, message: expect.stringMatching(mensaje) });
    expect(m.estado.transacciones).toBe(0);
  });

  it("3:00 pm con un servicio de 4 h (terminaría a las 7 pm) → 422", async () => {
    const m = montar();
    const e = await error(m.crear(conInicio("2026-11-07T15:00:00-05:00", { tipo: "estandar", dormitorios: 2, banos: 1 })));
    expect(e).toMatchObject({ status: 422, message: expect.stringMatching(/terminar antes/) });
  });

  it("47 h 59 min de anticipación → 422; exactamente 48 h se acepta", async () => {
    const ahora = instanteLocal("2026-11-05", "09:30", "America/Lima");
    const m = montar();
    // 2026-11-07 09:30 es exactamente 48 h después; 09:29:59 sería menos, así que se prueba con un ahora un minuto más tarde.
    const tarde = new Date(ahora.getTime() + 60_000);
    expect(await error(m.crear(conInicio("2026-11-07T09:30:00-05:00"), tarde))).toMatchObject({ status: 422, message: expect.stringMatching(/48 horas/) });
    await expect(m.crear(conInicio("2026-11-07T09:30:00-05:00"), ahora)).resolves.toBeDefined();
  });

  it("el límite de 3 meses: lunes 1 de febrero de 2027 sí, martes 2 de febrero no", async () => {
    const m = montar();
    await expect(m.crear(conInicio("2027-02-01T10:00:00-05:00"))).resolves.toBeDefined();
    const e = await error(montar().crear(conInicio("2027-02-02T10:00:00-05:00")));
    expect(e).toMatchObject({ status: 422, message: expect.stringContaining("2 de febrero de 2027") });
  });
});

describe("creación y montos", () => {
  const servicio = (tipo: string, dormitorios: number, banos: number) => ({ tipo, dormitorios, banos });

  it("profunda 2/1: precio 19350, 3 h gratis, monto 6966 y pago membresia_y_reserva por 33666", async () => {
    const m = montar();
    const r = await m.crear();
    expect(m.estado.reservas[0]).toMatchObject({
      precioLista: 19350,
      horasGratisAplicadas: "3",
      monto: 6966,
      primeraGratis: true,
      estado: "pendiente",
      horasTrabajo: "5",
      horasAgenda: "5",
      requiereApoyo: false,
      apoyoEstado: null,
    });
    expect(m.estado.pagos[0]).toMatchObject({ concepto: "membresia_y_reserva", monto: 33666, metodo: "yape", estado: "pendiente" });
    expect(m.estado.membresias[0]).toMatchObject({ monto: 26700, estado: "pendiente", usuarioId: "u1" });
    expect(r.reserva).toMatchObject({ estado: "pendiente", monto: 6966, horas_gratis_aplicadas: 3 });
    expect(r.pago).toMatchObject({ concepto: "membresia_y_reserva", monto: 33666 });
    expect(r.membresia).toMatchObject({ estado: "pendiente", monto: 26700 });
    // La reserva queda vinculada a su membresía y a su pago.
    expect(m.estado.reservas[0]).toMatchObject({ membresiaId: m.estado.membresias[0].id, pagoId: m.estado.pagos[0].id });
    expect(m.estado.pagos[0].membresiaId).toBe(m.estado.membresias[0].id);
  });

  it.each([
    ["estándar 1/1", servicio("estandar", 1, 1)],
    ["paquete de 3 h", { tipo: "paquete", horas: 3 }],
    ["estándar 0/1", servicio("estandar", 0, 1)],
  ])("%s → monto 0 y pago membresia por 26700", async (_n, s) => {
    const m = montar();
    await m.crear(cuerpo({ servicio: s }));
    expect(m.estado.reservas[0].monto).toBe(0);
    expect(m.estado.pagos[0]).toMatchObject({ concepto: "membresia", monto: 26700 });
  });

  it("estándar 0/1 aplica solo las 2 horas del servicio", async () => {
    const m = montar();
    await m.crear(cuerpo({ servicio: servicio("estandar", 0, 1) }));
    expect(m.estado.reservas[0].horasGratisAplicadas).toBe("2");
  });

  it("estándar 2/1 desde las 10:00 → fin 14:00 y bloqueo hasta las 15:00", async () => {
    const m = montar();
    await m.crear(cuerpo({ servicio: servicio("estandar", 2, 1) }));
    const r = m.estado.reservas[0];
    expect((r.inicio as Date).toISOString()).toBe("2026-11-07T15:00:00.000Z");
    expect((r.fin as Date).toISOString()).toBe("2026-11-07T19:00:00.000Z");
    expect((r.finBloqueo as Date).toISOString()).toBe("2026-11-07T20:00:00.000Z");
  });

  it("profunda 3/2 de 7 h desde las 08:00 → 3,5 h de agenda, apoyo por coordinar y bloqueo hasta las 12:30", async () => {
    const m = montar();
    await m.crear(cuerpo({ servicio: servicio("profunda", 3, 2), inicio: "2026-11-07T08:00:00-05:00" }));
    const r = m.estado.reservas[0];
    expect(r).toMatchObject({ horasTrabajo: "7", horasAgenda: "3.5", requiereApoyo: true, apoyoEstado: "por_coordinar", precioLista: 28350 });
    expect((r.finBloqueo as Date).toISOString()).toBe("2026-11-07T17:30:00.000Z"); // 12:30 en Lima
  });

  it("mudanza 3/1 → 4 h de agenda con apoyo y bloqueo hasta las 13:00", async () => {
    const m = montar();
    await m.crear(cuerpo({ servicio: servicio("mudanza", 3, 1), inicio: "2026-11-07T08:00:00-05:00" }));
    const r = m.estado.reservas[0];
    expect(r).toMatchObject({ horasAgenda: "4", requiereApoyo: true });
    expect((r.finBloqueo as Date).toISOString()).toBe("2026-11-07T18:00:00.000Z");
  });

  it.each([
    ["profunda 2/1", servicio("profunda", 2, 1)],
    ["mudanza 2/2", servicio("mudanza", 2, 2)],
  ])("%s no requiere apoyo", async (_n, s) => {
    const m = montar();
    await m.crear(cuerpo({ servicio: s }));
    expect(m.estado.reservas[0]).toMatchObject({ requiereApoyo: false, apoyoEstado: null });
  });

  it("paquete de 8 h desde las 08:00 → 8 h, sin apoyo, bloqueo hasta las 17:00", async () => {
    const m = montar();
    await m.crear(cuerpo({ servicio: { tipo: "paquete", horas: 8 }, inicio: "2026-11-07T08:00:00-05:00" }));
    const r = m.estado.reservas[0];
    expect(r).toMatchObject({ tipo: "paquete", dormitorios: null, banos: null, horasAgenda: "8", requiereApoyo: false });
    expect((r.finBloqueo as Date).toISOString()).toBe("2026-11-07T22:00:00.000Z");
  });

  it("los campos de monto del cuerpo se ignoran", async () => {
    const m = montar();
    await m.crear(cuerpo({ monto: 1, descuento: 99999, horas_gratis: 100, membresia_monto: 1 }));
    expect(m.estado.reservas[0]).toMatchObject({ monto: 6966, descuento: 774 });
    expect(m.estado.pagos[0].monto).toBe(33666);
    expect(m.estado.membresias[0].monto).toBe(26700);
  });

  it("el monto de la membresía sale de la configuración", async () => {
    const m = montar({}, { leerConfig: async () => ({ ...VALORES_DEL_DISENO, membresia_precio_mensual: 10000, membresia_meses: 2 }) });
    await m.crear(cuerpo({ servicio: { tipo: "paquete", horas: 3 } }));
    expect(m.estado.membresias[0].monto).toBe(20000);
    expect(m.estado.pagos[0].monto).toBe(20000);
  });

  it("el plazo de la reserva lo fija la base con espera_pago_horas (expresión SQL, no el reloj del servidor)", async () => {
    const m = montar();
    const r = await m.crear();
    // La fila guardada recibió una expresión SQL; la respuesta usa el instante que devolvió la base.
    expect(typeof m.estado.reservas[0].expiraEn).toBe("object");
    expect(r.reserva.expira_en).toBe("2026-11-03T10:00:00-05:00");
  });

  it("los equipos candidatos salen de la base (activos en orden) o del parámetro", async () => {
    const m = montar({ equipos: [4, 7] });
    await m.crear();
    expect(m.estado.operaciones).toContain("select:equipos");
    expect(m.estado.intentosDeEquipo).toEqual([4]);

    const propios = montar({}, { equipoIds: [9, 10] });
    await propios.crear();
    expect(propios.estado.operaciones).not.toContain("select:equipos");
    expect(propios.estado.intentosDeEquipo).toEqual([9]);
  });
});

describe("409", () => {
  it("un cliente con una reserva pendiente → 409 en_espera y nada insertado", async () => {
    const m = montar({ reservaPendiente: true });
    expect(await error(m.crear())).toMatchObject({ status: 409, codigo: "en_espera", message: MENSAJE_RESERVA_EN_ESPERA });
    expect(m.estado.operaciones.filter((o) => o.startsWith("insert"))).toEqual([]);
  });

  it("con una membresía pendiente y sin reserva viva → 409 de pago en revisión", async () => {
    const m = montar({ membresias: [{ id: "m0", estado: "pendiente" }] });
    expect(await error(m.crear())).toMatchObject({ status: 409, codigo: "en_espera", message: MENSAJE_MEMBRESIA_EN_REVISION });
    expect(m.estado.operaciones.filter((o) => o.startsWith("insert"))).toEqual([]);
  });

  it("con una membresía activa → 409 de reservar desde su perfil y sin horas gratis", async () => {
    const m = montar({ membresias: [{ id: "m0", estado: "activa" }], reservasVivas: true });
    expect(await error(m.crear())).toMatchObject({ status: 409, codigo: "en_espera", message: MENSAJE_YA_ES_MIEMBRO });
    expect(m.estado.reservas).toEqual([]);
  });

  it.each([
    ["membresias", "membresias_una_pendiente_por_cliente", MENSAJE_PAGO_EN_REVISION],
    ["reservas", "reservas_una_pendiente_por_cliente", MENSAJE_RESERVA_EN_ESPERA],
  ] as const)("el 23505 del índice de %s durante la inserción se traduce a 409 en_espera", async (tabla, indice, mensaje) => {
    const m = montar({ falloAlInsertar: { tabla, error: Object.assign(new Error("duplicado"), { cause: { code: "23505", constraint: indice } }) } });
    expect(await error(m.crear())).toMatchObject({ status: 409, codigo: "en_espera", message: mensaje });
    expect(m.estado.membresias).toEqual([]);
    expect(m.estado.pagos).toEqual([]);
  });

  it("otro 23505 no se traduce: sube como error inesperado", async () => {
    const original = Object.assign(new Error("duplicado"), { cause: { code: "23505", constraint: "otra" } });
    const m = montar({ falloAlInsertar: { tabla: "pagos", error: original } });
    expect(await error(m.crear())).toBe(original);
  });

  it("sin cupo → 409 conflicto y no queda ni membresía ni pago", async () => {
    const m = montar({ sinCupo: true });
    const e = await error(m.crear());
    expect(e).toMatchObject({ status: 409, codigo: "conflicto", message: expect.stringMatching(/Elige otra hora/) });
    expect(m.estado.intentosDeEquipo).toEqual([1, 2]);
    expect(m.estado.membresias).toEqual([]);
    expect(m.estado.pagos).toEqual([]);
    expect(m.estado.reservas).toEqual([]);
  });
});

describe("membresía atascada por un pago rechazado (design de revision-de-pagos-admin, decisión 4)", () => {
  const LIMITE = "2026-11-09T15:00:00.000Z"; // 10:00 en Lima

  it("membresía caducada: ya no cuenta y se crean membresía, pago y reserva nuevos", async () => {
    const m = montar({ membresias: [{ id: "m0", estado: "caducada" }] });
    const r = await m.crear();
    expect(r.reserva.estado).toBe("pendiente");
    expect(m.estado.membresias).toHaveLength(1);
    expect(m.estado.pagos).toHaveLength(1);
    expect(m.estado.reservas).toHaveLength(1);
  });

  it("el plazo venció: se cierra en la misma petición y el cliente empieza de nuevo", async () => {
    const m = montar({ membresias: [{ id: "m0", estado: "pendiente" }], cierra: ["m0"] });
    const r = await m.crear();
    expect(r.membresia.estado).toBe("pendiente");
    expect(m.estado.operaciones).toContain("update:cierre");
    expect(m.estado.membresias).toHaveLength(1);
    expect(m.estado.membresias[0]).not.toHaveProperty("id", "m0");
  });

  it("el cierre usa el plazo de configuración (reenvio_comprobante_dias), no un número fijo", async () => {
    const m = montar({}, { leerConfig: async () => ({ ...VALORES_DEL_DISENO, reenvio_comprobante_dias: 2 }) });
    await m.crear();
    expect(m.estado.operaciones).toContain("select:membresias:bloqueo");
  });

  it("pago rechazado dentro del plazo → 409 pago_rechazado con la fecha límite en hora de Lima", async () => {
    const m = montar({ membresias: [{ id: "m0", estado: "pendiente" }], ultimoPago: { estado: "rechazado", reenvioHasta: LIMITE } });
    const e = await error(m.crear());
    expect(e).toMatchObject({ status: 409, codigo: "pago_rechazado", message: "Tu comprobante fue rechazado. Sube otro comprobante desde tu perfil antes del 9 de noviembre de 2026." });
    expect(m.estado.operaciones.filter((o) => o.startsWith("insert"))).toEqual([]);
  });

  it("pago pendiente → sigue siendo en_espera con el mensaje de pago en revisión", async () => {
    const m = montar({ membresias: [{ id: "m0", estado: "pendiente" }], ultimoPago: { estado: "pendiente" } });
    expect(await error(m.crear())).toMatchObject({ status: 409, codigo: "en_espera", message: MENSAJE_MEMBRESIA_EN_REVISION });
  });

  it("la fecha del mensaje es la de Lima aunque el instante cruce la medianoche en UTC", () => {
    expect(mensajePagoRechazado(new Date("2026-11-10T03:00:00.000Z"), "America/Lima")).toContain("9 de noviembre de 2026");
  });
});

describe("transacción de escritura y WhatsApp", () => {
  it("expira las vencidas antes de leer los límites del cliente", async () => {
    const m = montar();
    await m.crear();
    // Primero las vencidas, luego el cierre por plazo de reenvío y solo después los límites del cliente.
    expect(m.estado.operaciones.slice(0, 3)).toEqual(["update:expirar", "select:membresias:bloqueo", "select:reservas"]);
    expect(m.estado.transacciones).toBe(1);
  });

  it("el enlace de WhatsApp sale de enlaceWhatsapp con el mensaje de la reserva", async () => {
    const m = montar();
    const r = await m.crear();
    expect(r.whatsapp!.startsWith(`https://wa.me/${WHATSAPP_EJEMPLO}?text=`)).toBe(true);
    const texto = decodeURIComponent(r.whatsapp!.split("?text=")[1]);
    expect(texto).toContain("María Pérez");
    expect(texto).toContain("Limpieza profunda");
    expect(texto).toContain("7 de noviembre de 2026");
    expect(texto).toContain("Miraflores");
    expect(texto).toContain("en espera");
  });

  it("sin número el enlace es null y la reserva se crea igual", async () => {
    const m = montar({}, { numeroWhatsapp: () => null });
    const r = await m.crear();
    expect(r.whatsapp).toBeNull();
    expect(m.estado.reservas).toHaveLength(1);
  });
});

describe("hogar que ya recibió la limpieza gratis", () => {
  it("estándar 2/1: sin horas gratis, monto 11610 y pago membresia_y_reserva por 38310", async () => {
    const m = montar({ hogarUsado: true });
    const r = await m.crear(cuerpo({ servicio: { tipo: "estandar", dormitorios: 2, banos: 1 } }));
    expect(m.estado.reservas[0]).toMatchObject({ primeraGratis: false, horasGratisAplicadas: "0", precioLista: 12900, monto: 11610 });
    expect(m.estado.pagos[0]).toMatchObject({ concepto: "membresia_y_reserva", monto: 38310 });
    expect(r.reserva).toMatchObject({ monto: 11610, horas_gratis_aplicadas: 0 });
  });

  it("estándar 1/1 de 3 h: monto 9900 x 0,9 = 8910 y concepto membresia_y_reserva (con gratis sería membresia)", async () => {
    const m = montar({ hogarUsado: true });
    await m.crear(cuerpo({ servicio: { tipo: "estandar", dormitorios: 1, banos: 1 } }));
    expect(m.estado.reservas[0]).toMatchObject({ primeraGratis: false, monto: 8910 });
    expect(m.estado.pagos[0]).toMatchObject({ concepto: "membresia_y_reserva", monto: 26700 + 8910 });
  });

  it("un hogar nuevo conserva el comportamiento actual (profunda 2/1 → 6966)", async () => {
    const m = montar({ hogarUsado: false });
    await m.crear();
    expect(m.estado.reservas[0]).toMatchObject({ primeraGratis: true, monto: 6966 });
    expect(m.estado.pagos[0].monto).toBe(33666);
  });

  it("el 23505 del índice por hogar durante la inserción sale como 409 limpieza_gratis_usada y se deshace todo", async () => {
    const m = montar({
      falloAlInsertar: { tabla: "reservas", error: Object.assign(new Error("duplicado"), { cause: { code: "23505", constraint: "reservas_primera_gratis_por_hogar" } }) },
    });
    expect(await error(m.crear())).toMatchObject({ status: 409, codigo: "limpieza_gratis_usada", message: MENSAJE_GRATIS_DEL_HOGAR_USADA });
    expect(m.estado.membresias).toEqual([]);
    expect(m.estado.pagos).toEqual([]);
    expect(m.estado.reservas).toEqual([]);
  });
});
