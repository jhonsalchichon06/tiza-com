import type { Cotizacion } from "../cotizar";
import type { RespuestaDeReserva } from "../crear";
import { horarioPermitido } from "./dias";
import type { ParametrosIniciales, TipoDeServicio } from "./parametros";

// Estado del asistente (ADR 0005: vive en el navegador hasta confirmar). Reductor puro, sin DOM: el navegador
// no calcula precios; solo guarda lo que eligió el cliente y lo que devolvió el servidor.

export type Paso = 1 | 2 | 3 | 4 | 5 | 6;
export type Metodo = "yape" | "transferencia";
export type HorarioElegido = { hora: string; inicio: string };

export type DireccionEscrita = {
  distrito: string;
  calle: string;
  numero: string;
  departamento: string;
  referencias: string;
};

export type ServicioElegido =
  | { tipo: "estandar" | "profunda" | "mudanza"; dormitorios: number; banos: number }
  | { tipo: "paquete"; horas: number };

export type Estado = {
  paso: Paso;
  tipo: TipoDeServicio | null;
  dormitorios: number | null; // null = campo vacío
  banos: number | null;
  horasPaquete: number | null;
  cotizacion: Cotizacion | null;
  // Clave de la dirección con la que se pidió la cotización vigente (null = cotizada sin dirección). En el paso de pago
  // se vuelve a cotizar si no coincide con la dirección escrita: el servidor decide si el hogar ya recibió la gratis.
  direccionCotizada: string | null;
  dia: string | null;
  horario: HorarioElegido | null;
  direccion: DireccionEscrita;
  metodo: Metodo | null;
  comprobante: string | null; // ruta ya subida a la tienda privada
  mensaje: string | null; // último aviso del servidor (409 de cupo, 422, red)
  bloqueado: boolean; // 409 de reserva o pago en revisión: no se ofrece reintentar
  // Si el bloqueo es un pago aprobado esperando horario: el enlace a la cuenta, donde se elige el nuevo día y hora.
  enlaceBloqueo: string | null;
  reserva: RespuestaDeReserva | null;
};

export type Accion =
  | { tipo: "elegir_servicio"; servicio: TipoDeServicio }
  | { tipo: "fijar_dormitorios"; valor: number | null }
  | { tipo: "fijar_banos"; valor: number | null }
  | { tipo: "elegir_paquete"; horas: number | null }
  | { tipo: "cotizacion_lista"; cotizacion: Cotizacion }
  | { tipo: "cotizacion_con_direccion"; cotizacion: Cotizacion; clave: string }
  | { tipo: "elegir_dia"; dia: string }
  | { tipo: "elegir_horario"; horario: HorarioElegido }
  | { tipo: "cambiar_direccion"; direccion: DireccionEscrita }
  | { tipo: "elegir_metodo"; metodo: Metodo }
  | { tipo: "comprobante_subido"; ruta: string | null }
  | { tipo: "siguiente" }
  | { tipo: "atras" }
  | { tipo: "ir_a"; paso: Paso }
  | { tipo: "sin_cupo"; mensaje: string; comprobante: string | null }
  | { tipo: "bloqueado"; mensaje: string; enlace?: string }
  | { tipo: "recotizar"; mensaje: string }
  | { tipo: "gratis_usada"; mensaje: string }
  | { tipo: "error_de_envio"; mensaje: string }
  | { tipo: "reserva_creada"; respuesta: RespuestaDeReserva };

export const DIRECCION_INICIAL: DireccionEscrita = { distrito: "", calle: "", numero: "", departamento: "", referencias: "" };

// Lo que identifica la dirección para la cotización (las referencias no cuentan). Igual al criterio del servidor: mismo
// distrito, calle, número y departamento escritos.
export function claveDeDireccion(d: DireccionEscrita): string {
  return JSON.stringify([d.distrito.trim(), d.calle.trim(), d.numero.trim(), d.departamento.trim()]);
}

export function estadoInicial(inicial: ParametrosIniciales): Estado {
  return {
    paso: 1,
    tipo: inicial.tipo,
    dormitorios: 1,
    banos: 1,
    horasPaquete: inicial.horas,
    cotizacion: null,
    direccionCotizada: null,
    dia: null,
    horario: null,
    direccion: { ...DIRECCION_INICIAL, distrito: inicial.distrito },
    metodo: null,
    comprobante: null,
    mensaje: null,
    bloqueado: false,
    enlaceBloqueo: null,
    reserva: null,
  };
}

// El servicio tal como se pide al servidor, o null si todavía falta algo o está fuera de rango.
export function servicioDeEstado(estado: Pick<Estado, "tipo" | "dormitorios" | "banos" | "horasPaquete">): ServicioElegido | null {
  if (estado.tipo === null) return null;
  if (estado.tipo === "paquete") return estado.horasPaquete === null ? null : { tipo: "paquete", horas: estado.horasPaquete };
  if (mensajeDeTamano(estado) !== null) return null;
  return { tipo: estado.tipo, dormitorios: estado.dormitorios as number, banos: estado.banos as number };
}

// Dormitorios desde 0 y baños desde 1; enteros. null si los valores están bien.
export function mensajeDeTamano(estado: Pick<Estado, "tipo" | "dormitorios" | "banos">): string | null {
  if (estado.tipo === null || estado.tipo === "paquete") return null;
  const { dormitorios, banos } = estado;
  if (dormitorios === null || !Number.isInteger(dormitorios) || dormitorios < 0) {
    return "Indica cuántos dormitorios tiene tu hogar (puede ser 0).";
  }
  if (banos === null || !Number.isInteger(banos) || banos < 1) {
    return "Tu hogar debe tener al menos 1 baño.";
  }
  return null;
}

// ¿La cotización vigente dice que la limpieza no tiene costo? Lo decide el servidor (total_a_pagar), no el navegador.
export function sinCosto(estado: Pick<Estado, "cotizacion">): boolean {
  return estado.cotizacion !== null && estado.cotizacion.total_a_pagar === 0;
}

export function puedeAvanzar(paso: Paso, estado: Estado): boolean {
  switch (paso) {
    case 1:
      return estado.tipo !== null;
    case 2:
      return servicioDeEstado(estado) !== null && estado.cotizacion !== null;
    case 3:
      return (
        estado.cotizacion !== null &&
        estado.dia !== null &&
        estado.horario !== null &&
        horarioPermitido(estado.horario.inicio, estado.cotizacion.limite)
      );
    case 4: {
      const d = estado.direccion;
      return d.distrito.trim() !== "" && d.calle.trim() !== "" && d.numero.trim() !== "";
    }
    case 5:
      // Sin nada que pagar (las horas gratis o el crédito cubren todo) no hace falta método ni comprobante.
      return sinCosto(estado) || (estado.metodo !== null && estado.comprobante !== null);
    default:
      return false;
  }
}

// Cambiar el servicio invalida la cotización y el horario (la duración cambia lo que cabe en la agenda).
const sinCotizacion = { cotizacion: null, direccionCotizada: null, horario: null } as const;

export function reductor(estado: Estado, accion: Accion): Estado {
  switch (accion.tipo) {
    case "elegir_servicio":
      return accion.servicio === estado.tipo ? estado : { ...estado, tipo: accion.servicio, ...sinCotizacion };
    case "fijar_dormitorios":
      return { ...estado, dormitorios: accion.valor, ...sinCotizacion };
    case "fijar_banos":
      return { ...estado, banos: accion.valor, ...sinCotizacion };
    case "elegir_paquete":
      return { ...estado, horasPaquete: accion.horas, ...sinCotizacion };
    case "cotizacion_lista":
      return { ...estado, cotizacion: accion.cotizacion, direccionCotizada: null };
    case "cotizacion_con_direccion":
      // Reemplaza solo los importes: el servicio no cambió, así que el día y la hora elegidos siguen siendo válidos.
      return { ...estado, cotizacion: accion.cotizacion, direccionCotizada: accion.clave };
    case "elegir_dia":
      return accion.dia === estado.dia ? estado : { ...estado, dia: accion.dia, horario: null };
    case "elegir_horario":
      return { ...estado, horario: accion.horario, mensaje: null };
    case "cambiar_direccion":
      return { ...estado, direccion: accion.direccion };
    case "elegir_metodo":
      return { ...estado, metodo: accion.metodo };
    case "comprobante_subido":
      return { ...estado, comprobante: accion.ruta, mensaje: null };
    case "siguiente":
      if (estado.paso >= 5 || !puedeAvanzar(estado.paso, estado)) return estado;
      return { ...estado, paso: (estado.paso + 1) as Paso, mensaje: null };
    case "atras":
      if (estado.paso <= 1 || estado.paso >= 6) return estado;
      return { ...estado, paso: (estado.paso - 1) as Paso, mensaje: null };
    case "ir_a":
      return estado.paso >= 6 ? estado : { ...estado, paso: accion.paso, mensaje: null };
    case "sin_cupo":
      // Vuelve a elegir fecha y hora conservando servicio, dirección y el comprobante ya subido.
      return { ...estado, paso: 3, horario: null, mensaje: accion.mensaje, comprobante: accion.comprobante ?? estado.comprobante };
    case "bloqueado":
      return { ...estado, mensaje: accion.mensaje, bloqueado: true, enlaceBloqueo: accion.enlace ?? null };
    case "recotizar":
      // La cotización que vio el cliente ya no vale (decía que no había nada que pagar): se cotiza de nuevo con la dirección y
      // el paso de pago vuelve a pedir método y comprobante.
      return { ...estado, mensaje: accion.mensaje, direccionCotizada: null, comprobante: null };
    case "gratis_usada":
      // Otra cuenta se llevó la limpieza gratis de este hogar: el monto cambia, así que se cotiza de nuevo y el comprobante
      // ya subido (por el monto anterior) no sirve; se sube otro.
      return { ...estado, mensaje: accion.mensaje, direccionCotizada: null, comprobante: null };
    case "error_de_envio":
      return { ...estado, mensaje: accion.mensaje };
    case "reserva_creada":
      return { ...estado, paso: 6, reserva: accion.respuesta, mensaje: null };
  }
}

