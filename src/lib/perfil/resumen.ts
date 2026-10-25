import { db } from "@/db/cliente";
import { ejecutarPasadaDeExpiracion } from "../agenda/pasada";
import type { BaseDatos } from "../agenda/expirar";
import { errorOriginal } from "../agenda/errores-bd";
import { isoConZona } from "../agenda/horario";
import { leerConfiguracion, type Configuracion } from "../configuracion";
import { ErrorApi } from "../errores";
import { pagosRechazadosReenviables } from "../pagos/reenvio-plazo";
import { planDeRenovacion } from "../membresia/plan";
import { estadoDeRenovacion, sinRenovacionesPendientes, type Renovacion } from "../membresia/renovacion";
import { conReintento } from "../reintento";
import type { Usuario } from "../sesion";
import { leerSaldoYVencimiento } from "../creditos/saldo";
import { construirAvisos, type Aviso } from "./avisos";
import { limpiezaGratisConservada } from "./gratis-conservada";
import { estadoDeMembresia, leerMembresiaDelCliente, type MembresiaDelPerfil, type PagoReenviable } from "./membresia";
import { pagosParaElegirHorario } from "./nuevo-horario";
import { listarHistorial, listarProximas, type HistorialVista, type ProximaVista } from "./reservas";

export type RespuestaPerfil = {
  membresia: MembresiaDelPerfil;
  // Aviso de renovación del mes 4 (renovacion-del-mes-4): se calcula al leer, no se guarda.
  renovacion: Renovacion;
  avisos: Aviso[];
  proximas: ProximaVista[];
  historial: HistorialVista[];
  // Crédito en horas (ítem 14): saldo vigente y próximo vencimiento. Con la membresía vencida el saldo se ve, pero hace falta
  // renovar para usarlo (ADR 0012); el detalle está en `/api/creditos`.
  credito: { saldo_horas: number; proximo_vencimiento: { horas: number; vence_en: string } | null; membresia_vencida: boolean };
};

export type ConfigDelPerfil = Pick<
  Configuracion,
  "cancelacion_minima_horas" | "horario_atencion" | "horas_gratis" | "reenvio_comprobante_dias" | "membresia_meses" | "membresia_precio_mensual" | "renovacion_aviso_dias"
>;

export type DependenciasPerfil = {
  base: () => Pick<BaseDatos, "select" | "transaction" | "execute">;
  leerConfig: () => Promise<ConfigDelPerfil>;
  // Persiste lo vencido (reservas `pendiente` → `expirada`, membresías sin reenvío → `caducada`). Ítem 11.
  pasada: (base: Pick<BaseDatos, "transaction">, leerConfig: () => Promise<ConfigDelPerfil>) => Promise<unknown>;
  rechazadosReenviables: (base: Pick<BaseDatos, "select">, usuarioId: string, config: ConfigDelPerfil) => Promise<{ pagoId: string; membresiaId: string | null; reenvioHasta: string; motivoRechazo: string | null }[]>;
  esperaReintentoMs?: number;
};

const porDefecto: DependenciasPerfil = {
  base: () => db(),
  leerConfig: () => leerConfiguracion(),
  pasada: (base, leerConfig) => ejecutarPasadaDeExpiracion(base, leerConfig),
  rechazadosReenviables: (base, usuarioId, config) => pagosRechazadosReenviables(base, usuarioId, config),
};

// Lee el perfil completo del cliente. Antes de leer, la pasada de expiración persiste lo que las lecturas ya calculan con
// `reservaActiva` y el reloj de la base (la pasada persiste, no decide). Todo bajo `conReintento` con el error original
// (Neon dormido: un reintento y luego 503). Cada lectura lleva el `usuario_id` de la sesión.
export async function leerPerfil(entrada: { usuario: Pick<Usuario, "id">; ahora: Date }, dependencias: Partial<DependenciasPerfil> = {}): Promise<RespuestaPerfil> {
  return (await leerPerfilConZona(entrada, dependencias)).perfil;
}

// Lo mismo, más la zona horaria de `configuracion` que la página usa para escribir las fechas (no forma parte de la respuesta de la API).
export async function leerPerfilConZona(
  { usuario, ahora }: { usuario: Pick<Usuario, "id">; ahora: Date },
  dependencias: Partial<DependenciasPerfil> = {},
): Promise<{ perfil: RespuestaPerfil; zona: string }> {
  const d = { ...porDefecto, ...dependencias };
  return conReintento(async () => {
    try {
      const base = d.base();
      const config = await d.leerConfig();
      await d.pasada(base, async () => config);

      const rechazadosCrudos = await d.rechazadosReenviables(base, usuario.id, config);
      const rechazados: PagoReenviable[] = rechazadosCrudos.map((r) => ({ pagoId: r.pagoId, reenvioHasta: new Date(r.reenvioHasta), motivoRechazo: r.motivoRechazo }));
      const filas = await leerMembresiaDelCliente(base, usuario.id);
      const zona = config.horario_atencion.zona;
      // Una pendiente junto a una activa es una renovación: no se muestra como «primera membresía en revisión».
      const membresia = estadoDeMembresia({ membresias: sinRenovacionesPendientes(filas), pagosReenviables: rechazados, zona });
      const renovacion = estadoDeRenovacion({ membresias: filas, pagosReenviables: rechazados, avisoDias: config.renovacion_aviso_dias, zona, plan: planDeRenovacion(config), ahora });
      const pagosNuevoHorario = await pagosParaElegirHorario(base, usuario.id);
      const proximas = await listarProximas(base, usuario.id, config, ahora);
      const historial = await listarHistorial(base, usuario.id, config);
      const gratisConservada = await limpiezaGratisConservada(base, usuario.id, membresia);
      const saldo = await leerSaldoYVencimiento(base, usuario.id);

      const enEspera = proximas.find((p) => p.estado === "pendiente");
      const avisosBase = construirAvisos({
        membresia,
        rechazados,
        pagosNuevoHorario,
        gratisConservada,
        config,
        zona,
        ahora,
        reservaEnEsperaHasta: enEspera?.expira_en ?? null,
      });
      // «Tu membresía venció el…» lo dice ahora el bloque de renovación (con el plan y el botón): no se repite como aviso.
      const avisos = avisosBase.filter((a) => a.codigo !== "vencida");
      const credito = {
        saldo_horas: saldo.horas,
        proximo_vencimiento: saldo.proximoVencimiento ? { horas: saldo.proximoVencimiento.horas, vence_en: isoConZona(saldo.proximoVencimiento.venceEn, zona) } : null,
        membresia_vencida: membresia.estado === "vencida",
      };
      return { perfil: { membresia, renovacion, avisos, proximas, historial, credito }, zona };
    } catch (error) {
      throw error instanceof ErrorApi ? error : errorOriginal(error);
    }
  }, d.esperaReintentoMs);
}
