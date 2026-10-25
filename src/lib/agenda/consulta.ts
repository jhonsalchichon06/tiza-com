import { z } from "zod";
import { db } from "@/db/cliente";
import { leerConfiguracion, type Configuracion } from "../configuracion";
import { ErrorApi } from "../errores";
import { calcularServicio, type EntradaServicio } from "../precios";
import { conReintento } from "../reintento";
import { calcularDisponibilidad, type Disponibilidad, type EquipoAgenda, type Ocupacion } from "./disponibilidad";
import { errorOriginal } from "./errores-bd";
import { instanteLocal, validarFecha } from "./horario";
import { leerOcupacion } from "./leer";

type Dependencias = {
  leerConfig: () => Promise<Configuracion>;
  leerOcupacion: (ventana: { desde: Date; hasta: Date }) => Promise<{ equipos: EquipoAgenda[]; ocupadas: Ocupacion[] }>;
};

const porDefecto: Dependencias = {
  leerConfig: () => leerConfiguracion(),
  leerOcupacion: (ventana) => leerOcupacion(db(), ventana),
};

const TIPOS = ["estandar", "profunda", "mudanza", "paquete"] as const;
const esquemaTipo = z.enum(TIPOS, { error: "Elige un tipo de servicio válido." });

// Los números llegan como texto en la URL; uno ausente se deja como `undefined` para que calcularServicio
// diga cuál falta (0 dormitorios es válido, así que un valor ausente no puede convertirse en 0).
const numero = (valor: string | null): number | undefined => (valor === null || valor.trim() === "" ? undefined : Number(valor));

export function entradaDeServicio(parametros: URLSearchParams): EntradaServicio {
  const tipo = esquemaTipo.safeParse(parametros.get("tipo"));
  if (!tipo.success) throw ErrorApi.invalido(tipo.error.issues[0]?.message ?? "Elige un tipo de servicio válido.");
  if (tipo.data === "paquete") return { tipo: "paquete", horas: numero(parametros.get("horas")) as number };
  return {
    tipo: tipo.data,
    dormitorios: numero(parametros.get("dormitorios")) as number,
    banos: numero(parametros.get("banos")) as number,
  };
}

// GET /api/disponibilidad: lee la configuración y la ocupación del día y calcula los horarios. No escribe ni
// mira la membresía (eso lo hacen #9 y #13). Las lecturas se reintentan una vez si Neon está dormido; Drizzle
// envuelve el error de conexión en `cause`, así que se le da el original a `conReintento`.
export async function consultarDisponibilidad(
  { parametros, ahora }: { parametros: URLSearchParams; ahora: Date },
  dependencias: Dependencias = porDefecto,
): Promise<Disponibilidad> {
  const fecha = validarFecha(parametros.get("fecha"));
  const servicio = entradaDeServicio(parametros);

  return conReintento(async () => {
    try {
      const config = await dependencias.leerConfig();
      const { horas_agenda } = calcularServicio(config, servicio);
      // El día local completo, con holgura: una reserva solo molesta si su rango bloqueado toca el día.
      const desde = instanteLocal(fecha, "00:00", config.horario_atencion.zona);
      const hasta = new Date(desde.getTime() + 30 * 3_600_000);
      const { equipos, ocupadas } = await dependencias.leerOcupacion({ desde, hasta });
      return calcularDisponibilidad({ config, ahora, fecha, horasAgenda: horas_agenda, equipos, ocupadas });
    } catch (error) {
      throw error instanceof ErrorApi ? error : errorOriginal(error);
    }
  });
}
