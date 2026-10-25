import { db } from "@/db/cliente";
import { leerConfiguracion } from "../configuracion";
import { ErrorApi, manejar } from "../errores";
import { comprobarVigenciaDeLaConsulta } from "../membresia/vigencia-miembro";
import { conReintento } from "../reintento";
import { requerirSesion, type Usuario } from "../sesion";
import { errorOriginal } from "./errores-bd";
import { consultarDisponibilidad } from "./consulta";

// Comprueba la vigencia de la membresía de quien ya es miembro (renovacion-del-mes-4): lanza 409 `membresia_vencida`,
// 409 `renovacion_en_revision` o 422 `fuera_de_vigencia`. Un cliente sin ninguna membresía `activa` pasa sin cambios.
export type ComprobarVigencia = (usuario: Pick<Usuario, "id">, parametros: URLSearchParams) => Promise<void>;

const vigenciaPorDefecto: ComprobarVigencia = (usuario, parametros) =>
  conReintento(async () => {
    try {
      const config = await leerConfiguracion();
      await comprobarVigenciaDeLaConsulta({ base: db(), usuarioId: usuario.id, fecha: parametros.get("fecha"), config });
    } catch (error) {
      throw error instanceof ErrorApi ? error : errorOriginal(error);
    }
  });

type Dependencias = {
  sesion?: (cabeceras: Headers) => Promise<Usuario>;
  consultar?: typeof consultarDisponibilidad;
  vigencia?: ComprobarVigencia;
  ahora?: () => Date;
};

// GET /api/disponibilidad. Exige sesión: una agenda pública mostraría la ocupación del negocio sin cuenta. Para quien ya es
// miembro aplica además el guard de vigencia (sin membresía vigente no se eligen día y hora).
export function crearRutaDisponibilidad({
  sesion = (cabeceras) => requerirSesion(cabeceras),
  consultar = consultarDisponibilidad,
  vigencia = vigenciaPorDefecto,
  ahora = () => new Date(),
}: Dependencias = {}) {
  return manejar(async (req: Request) => {
    const usuario = await sesion(req.headers);
    const { searchParams } = new URL(req.url);
    await vigencia(usuario, searchParams);
    const resultado = await consultar({ parametros: searchParams, ahora: ahora() });
    return Response.json(resultado, { headers: { "Cache-Control": "private, no-store" } });
  });
}
