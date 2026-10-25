import { describe, expect, it, vi } from "vitest";
import { ErrorImagen, MENSAJE_SUBIDA } from "@/lib/imagenes/cliente";
import { MENSAJE_SIN_CONEXION } from "./api-cliente";
import { MIEMBRO_CREDITO_CUBRE, MIEMBRO_CREDITO_PARCIAL, MIEMBRO_ESTANDAR_2_1, MIEMBRO_SIN_COSTO, RESPUESTA_201, RESPUESTA_MIEMBRO_201, RESPUESTA_MIEMBRO_CONFIRMADA } from "./__dobles__/cotizaciones";
import { confirmarReserva, type Candado, type DependenciasDeConfirmar } from "./confirmar";
import { estadoInicial, reductor, type Accion, type Estado } from "./estado";

const aplicar = (estado: Estado, ...acciones: Accion[]) => acciones.reduce(reductor, estado);
const ESTADO: Estado = aplicar(
  estadoInicial({ distrito: "", tipo: null, horas: null }),
  { tipo: "elegir_servicio", servicio: "profunda" },
  { tipo: "elegir_horario", horario: { hora: "09:00", inicio: "2026-11-09T09:00:00-05:00" } },
  { tipo: "cambiar_direccion", direccion: { distrito: "Barranco", calle: "Jr. Junín", numero: "45", departamento: "", referencias: "" } },
  { tipo: "elegir_metodo", metodo: "yape" },
);
const ARCHIVO = { name: "c.jpg", type: "image/jpeg", size: 1000 } as File;
const RUTA = "comprobantes/u1/1.webp";

const json = (cuerpo: unknown, status: number) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
const error = (status: number, codigo: string, mensaje: string) => json({ error: { codigo, mensaje } }, status);

function dependencias(respuesta: () => Promise<Response> | Response, subida: () => Promise<string> = async () => RUTA) {
  const subir = vi.fn(subida);
  const pedir = vi.fn(async () => respuesta());
  const candado: Candado = { enCurso: null };
  return { subir, pedir, candado, deps: { subir, pedir, candado } satisfies DependenciasDeConfirmar };
}

describe("confirmarReserva", () => {
  it("sube la imagen y después envía la reserva con la ruta", async () => {
    const { deps, subir, pedir } = dependencias(() => json(RESPUESTA_201, 201));
    const resultado = await confirmarReserva({ estado: ESTADO, archivo: ARCHIVO }, deps);
    expect(resultado).toEqual({ tipo: "ok", respuesta: RESPUESTA_201 });
    expect(subir).toHaveBeenCalledTimes(1);
    expect(pedir).toHaveBeenCalledTimes(1);
    const [url, init] = pedir.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/reservas");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).comprobante).toBe(RUTA);
  });

  it("si la subida falla no envía la reserva y muestra el error", async () => {
    const { deps, pedir } = dependencias(() => json(RESPUESTA_201, 201), async () => {
      throw new ErrorImagen(MENSAJE_SUBIDA);
    });
    const resultado = await confirmarReserva({ estado: ESTADO, archivo: ARCHIVO }, deps);
    expect(resultado).toEqual({ tipo: "error", mensaje: MENSAJE_SUBIDA });
    expect(pedir).not.toHaveBeenCalled();
  });

  it("sin archivo ni ruta no envía nada", async () => {
    const { deps, pedir } = dependencias(() => json(RESPUESTA_201, 201));
    const resultado = await confirmarReserva({ estado: ESTADO }, deps);
    expect(resultado.tipo).toBe("error");
    expect(pedir).not.toHaveBeenCalled();
  });

  it("con la ruta ya subida no vuelve a subir", async () => {
    const { deps, subir } = dependencias(() => json(RESPUESTA_201, 201));
    await confirmarReserva({ estado: { ...ESTADO, comprobante: RUTA }, archivo: ARCHIVO }, deps);
    expect(subir).not.toHaveBeenCalled();
  });

  it("dos llamadas seguidas envían una sola petición", async () => {
    let liberar!: () => void;
    const espera = new Promise<void>((r) => (liberar = r));
    const { deps, pedir } = dependencias(async () => {
      await espera;
      return json(RESPUESTA_201, 201);
    });
    const a = confirmarReserva({ estado: ESTADO, archivo: ARCHIVO }, deps);
    const b = confirmarReserva({ estado: ESTADO, archivo: ARCHIVO }, deps);
    liberar();
    expect(await a).toEqual(await b);
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it("el candado se libera al terminar", async () => {
    const { deps, pedir } = dependencias(() => error(422, "datos_invalidos", "Revisa el número."));
    await confirmarReserva({ estado: { ...ESTADO, comprobante: RUTA } }, deps);
    await confirmarReserva({ estado: { ...ESTADO, comprobante: RUTA } }, deps);
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it("409 conflicto: sin_cupo, y el reintento reutiliza la ruta ya subida", async () => {
    const { deps, subir } = dependencias(() => error(409, "conflicto", "Esa hora ya no está libre. Elige otra."));
    const primero = await confirmarReserva({ estado: ESTADO, archivo: ARCHIVO }, deps);
    expect(primero).toEqual({ tipo: "sin_cupo", mensaje: "Esa hora ya no está libre. Elige otra.", comprobante: RUTA });

    const siguiente = reductor(ESTADO, { tipo: "sin_cupo", mensaje: "x", comprobante: RUTA });
    await confirmarReserva({ estado: reductor(siguiente, { tipo: "elegir_horario", horario: { hora: "10:00", inicio: "2026-11-09T10:00:00-05:00" } }), archivo: ARCHIVO }, deps);
    expect(subir).toHaveBeenCalledTimes(1);
  });

  it("409 en_espera: bloqueado", async () => {
    const { deps } = dependencias(() => error(409, "en_espera", "Ya tienes un pago en revisión."));
    expect(await confirmarReserva({ estado: { ...ESTADO, comprobante: RUTA } }, deps)).toEqual({
      tipo: "bloqueado",
      mensaje: "Ya tienes un pago en revisión.",
    });
  });

  it("409 limpieza_gratis_usada: gratis_usada con el mensaje del servidor (no es bloqueado ni sin_cupo)", async () => {
    const { deps } = dependencias(() => error(409, "limpieza_gratis_usada", "Otra cuenta ya recibió la limpieza gratis de esta dirección. Revisa el precio actualizado y confirma de nuevo."));
    expect(await confirmarReserva({ estado: { ...ESTADO, comprobante: RUTA } }, deps)).toEqual({
      tipo: "gratis_usada",
      mensaje: "Otra cuenta ya recibió la limpieza gratis de esta dirección. Revisa el precio actualizado y confirma de nuevo.",
    });
  });

  it("distingue los 409 por código y no por el texto", async () => {
    const { deps } = dependencias(() => error(409, "conflicto", "Ya tienes un pago en revisión."));
    expect((await confirmarReserva({ estado: { ...ESTADO, comprobante: RUTA } }, deps)).tipo).toBe("sin_cupo");
  });

  it("422: error con el mensaje del servidor", async () => {
    const { deps } = dependencias(() => error(422, "datos_invalidos", "Escribe el número de la dirección."));
    expect(await confirmarReserva({ estado: { ...ESTADO, comprobante: RUTA } }, deps)).toEqual({
      tipo: "error",
      mensaje: "Escribe el número de la dirección.",
    });
  });

  it("un fallo de red da un error con mensaje claro", async () => {
    const { deps } = dependencias(() => {
      throw new TypeError("fetch failed");
    });
    expect(await confirmarReserva({ estado: { ...ESTADO, comprobante: RUTA } }, deps)).toEqual({ tipo: "error", mensaje: MENSAJE_SIN_CONEXION });
  });

  it("una respuesta sin cuerpo da el mensaje genérico", async () => {
    const { deps } = dependencias(() => new Response("", { status: 500 }));
    const r = await confirmarReserva({ estado: { ...ESTADO, comprobante: RUTA } }, deps);
    expect(r).toMatchObject({ tipo: "error" });
  });
});

describe("confirmarReserva en modo miembro", () => {
  const SIN_COSTO: Estado = aplicar(ESTADO, { tipo: "cotizacion_lista", cotizacion: MIEMBRO_SIN_COSTO() });
  const CON_COSTO: Estado = aplicar(ESTADO, { tipo: "cotizacion_lista", cotizacion: MIEMBRO_ESTANDAR_2_1() });

  it("con monto 0 confirma sin archivo ni método: no sube nada y el cuerpo no lleva comprobante", async () => {
    const { deps, subir, pedir } = dependencias(() => json(RESPUESTA_MIEMBRO_CONFIRMADA, 201));
    const r = await confirmarReserva({ estado: SIN_COSTO }, deps);
    expect(r).toEqual({ tipo: "ok", respuesta: RESPUESTA_MIEMBRO_CONFIRMADA });
    expect(subir).not.toHaveBeenCalled();
    const cuerpo = JSON.parse((pedir.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(cuerpo).not.toHaveProperty("comprobante");
    expect(cuerpo).not.toHaveProperty("metodo");
    expect(JSON.stringify(cuerpo)).not.toMatch(/monto|precio|descuento/);
  });

  it("con el crédito cubriendo todo no sube nada y el cuerpo no lleva comprobante ni método", async () => {
    const cubierta: Estado = aplicar(ESTADO, { tipo: "cotizacion_lista", cotizacion: MIEMBRO_CREDITO_CUBRE() });
    const { deps, subir, pedir } = dependencias(() => json(RESPUESTA_MIEMBRO_CONFIRMADA, 201));
    const r = await confirmarReserva({ estado: cubierta }, deps);
    expect(r.tipo).toBe("ok");
    expect(subir).not.toHaveBeenCalled();
    const cuerpo = JSON.parse((pedir.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(cuerpo).not.toHaveProperty("comprobante");
    expect(cuerpo).not.toHaveProperty("metodo");
  });

  it("con el crédito cubriendo solo una parte sí pide y envía el comprobante", async () => {
    const parcial: Estado = aplicar(ESTADO, { tipo: "cotizacion_lista", cotizacion: MIEMBRO_CREDITO_PARCIAL() });
    const { deps, subir, pedir } = dependencias(() => json(RESPUESTA_MIEMBRO_201, 201));
    await confirmarReserva({ estado: parcial, archivo: ARCHIVO }, deps);
    expect(subir).toHaveBeenCalledTimes(1);
    expect(JSON.parse((pedir.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ comprobante: RUTA });
  });

  it("con monto 0 ignora un comprobante que ya estuviera subido", async () => {
    const { deps, pedir } = dependencias(() => json(RESPUESTA_MIEMBRO_CONFIRMADA, 201));
    await confirmarReserva({ estado: { ...SIN_COSTO, comprobante: RUTA }, archivo: ARCHIVO }, deps);
    expect(JSON.parse((pedir.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).not.toHaveProperty("comprobante");
  });

  it("con monto mayor que 0 sigue subiendo el comprobante y lo envía", async () => {
    const { deps, subir, pedir } = dependencias(() => json(RESPUESTA_MIEMBRO_201, 201));
    await confirmarReserva({ estado: CON_COSTO, archivo: ARCHIVO }, deps);
    expect(subir).toHaveBeenCalledTimes(1);
    expect(JSON.parse((pedir.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ metodo: "yape", comprobante: RUTA });
  });

  it("con monto mayor que 0 y sin archivo ni ruta no envía nada", async () => {
    const { deps, pedir } = dependencias(() => json(RESPUESTA_MIEMBRO_201, 201));
    expect(await confirmarReserva({ estado: CON_COSTO }, deps)).toMatchObject({ tipo: "error" });
    expect(pedir).not.toHaveBeenCalled();
  });

  it("409 horario_pendiente: bloqueado con el enlace a la cuenta", async () => {
    const { deps } = dependencias(() => error(409, "horario_pendiente", "Tienes un pago aprobado esperando horario. Elige tu nuevo día y hora desde tu cuenta."));
    expect(await confirmarReserva({ estado: { ...CON_COSTO, comprobante: RUTA } }, deps)).toEqual({
      tipo: "bloqueado",
      mensaje: "Tienes un pago aprobado esperando horario. Elige tu nuevo día y hora desde tu cuenta.",
      enlace: "/cuenta",
    });
  });

  it("422 comprobante_requerido: recotizar con el mensaje del servidor", async () => {
    const { deps } = dependencias(() => error(422, "comprobante_requerido", "Sube el comprobante de tu pago para continuar."));
    expect(await confirmarReserva({ estado: SIN_COSTO }, deps)).toEqual({ tipo: "recotizar", mensaje: "Sube el comprobante de tu pago para continuar." });
  });

  it("409 conflicto con monto 0: sin_cupo sin comprobante", async () => {
    const { deps } = dependencias(() => error(409, "conflicto", "Esa hora ya no está disponible. Elige otra hora."));
    expect(await confirmarReserva({ estado: SIN_COSTO }, deps)).toEqual({ tipo: "sin_cupo", mensaje: "Esa hora ya no está disponible. Elige otra hora.", comprobante: null });
  });

  it("409 en_espera y limpieza_gratis_usada conservan su destino", async () => {
    expect((await confirmarReserva({ estado: SIN_COSTO }, dependencias(() => error(409, "en_espera", "x")).deps)).tipo).toBe("bloqueado");
    expect((await confirmarReserva({ estado: SIN_COSTO }, dependencias(() => error(409, "limpieza_gratis_usada", "x")).deps)).tipo).toBe("gratis_usada");
  });

  it("el candado contra el doble envío sigue: dos llamadas, una petición", async () => {
    let liberar!: () => void;
    const espera = new Promise<void>((r) => (liberar = r));
    const { deps, pedir } = dependencias(async () => {
      await espera;
      return json(RESPUESTA_MIEMBRO_CONFIRMADA, 201);
    });
    const a = confirmarReserva({ estado: SIN_COSTO }, deps);
    const b = confirmarReserva({ estado: SIN_COSTO }, deps);
    liberar();
    expect(await a).toEqual(await b);
    expect(pedir).toHaveBeenCalledTimes(1);
  });
});
