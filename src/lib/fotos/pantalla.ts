import { eq } from "drizzle-orm";
import { db } from "@/db/cliente";
import { reservas, usuarios } from "@/db/esquema";
import type { BaseDatos } from "../agenda/expirar";
import { isoConZona } from "../agenda/horario";
import { leerConfiguracion } from "../configuracion";
import { esUuid } from "../uuid";
import { listarFotosDeReserva, type FotoVista } from "./listar";

export type DatosPantallaFotos = {
  reserva: {
    id: string;
    estado: "pendiente" | "confirmada" | "completada" | "cancelada" | "expirada";
    cliente: string;
    servicio: { tipo: string; dormitorios: number | null; banos: number | null; horas_trabajo: number };
    direccion: { distrito: string; calle: string; numero: string; departamento: string | null };
    inicio: string;
  };
  limite: number;
  fotos: FotoVista[];
};

export type DependenciasPantallaFotos = {
  base: () => Pick<BaseDatos, "select">;
  leerLimiteYZona: () => Promise<{ limite: number; zona: string }>;
};

const porDefecto: DependenciasPantallaFotos = {
  base: () => db(),
  leerLimiteYZona: async () => {
    const c = await leerConfiguracion();
    return { limite: c.fotos_maximas_por_reserva, zona: c.horario_atencion.zona };
  },
};

// Lo que muestra /admin/reservas/[id]/fotos, leído en el servidor sin pasar por HTTP (el rol admin lo exige el layout de /admin).
// `null` si el id no es un uuid o la reserva no existe (la página responde «no encontrada»). Solo carga las fotos de una
// reserva `completada`: las demás no pueden tenerlas.
export async function leerPantallaFotos(reservaId: string, dependencias: DependenciasPantallaFotos = porDefecto): Promise<DatosPantallaFotos | null> {
  if (!esUuid(reservaId)) return null;
  const base = dependencias.base();
  const [fila] = await base
    .select({
      id: reservas.id,
      estado: reservas.estado,
      cliente: usuarios.name,
      tipo: reservas.tipo,
      dormitorios: reservas.dormitorios,
      banos: reservas.banos,
      horasTrabajo: reservas.horasTrabajo,
      distrito: reservas.distrito,
      calle: reservas.calle,
      numero: reservas.numero,
      departamento: reservas.departamento,
      inicio: reservas.inicio,
    })
    .from(reservas)
    .innerJoin(usuarios, eq(usuarios.id, reservas.usuarioId))
    .where(eq(reservas.id, reservaId))
    .limit(1);
  if (!fila) return null;

  const { limite, zona } = await dependencias.leerLimiteYZona();
  const fotos = fila.estado === "completada" ? await listarFotosDeReserva(base, fila.id) : [];
  return {
    reserva: {
      id: fila.id,
      estado: fila.estado,
      cliente: fila.cliente,
      servicio: { tipo: fila.tipo, dormitorios: fila.dormitorios, banos: fila.banos, horas_trabajo: Number(fila.horasTrabajo) },
      direccion: { distrito: fila.distrito, calle: fila.calle, numero: fila.numero, departamento: fila.departamento },
      inicio: isoConZona(fila.inicio, zona),
    },
    limite,
    fotos,
  };
}
