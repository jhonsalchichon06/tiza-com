import { config } from "dotenv";
import { del } from "@vercel/blob";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

config({ path: ".env.local", quiet: true });
neonConfig.webSocketConstructor = ws;

// Borra de la rama `pruebas` todo lo que creó una corrida (por su correo @tiza.test) y el comprobante subido al Blob.
export async function borrarRastrosDe(correo: string) {
  const url = process.env.DATABASE_URL_PRUEBAS;
  if (!url || url === process.env.DATABASE_URL) throw new Error("DATABASE_URL_PRUEBAS falta o es la de producción: no se limpia nada.");
  if (!correo.endsWith("@tiza.test")) throw new Error("Solo se limpian cuentas @tiza.test.");
  const pool = new Pool({ connectionString: url });
  try {
    const { rows } = await pool.query("select id from usuarios where email = $1", [correo]);
    if (rows.length === 0) return;
    const ids = rows.map((r) => r.id);
    const rutas = (await pool.query("select comprobante_ruta from pagos where usuario_id = any($1) and comprobante_ruta is not null", [ids])).rows.map((r) => r.comprobante_ruta as string);
    const reservasDe = "select id from reservas where usuario_id = any($1)";
    await pool.query(`delete from usos_credito where reserva_destino_id in (${reservasDe})`, [ids]);
    await pool.query(`delete from creditos_horas where usuario_id = any($1) or reserva_origen_id in (${reservasDe})`, [ids]);
    await pool.query(`delete from resenas where reserva_id in (${reservasDe})`, [ids]);
    await pool.query(`delete from fotos_servicio where reserva_id in (${reservasDe})`, [ids]);
    await pool.query("delete from reservas where usuario_id = any($1)", [ids]);
    await pool.query("update pagos set reemplaza_a = null where usuario_id = any($1)", [ids]);
    await pool.query("delete from pagos where usuario_id = any($1)", [ids]);
    await pool.query("delete from membresias where usuario_id = any($1)", [ids]);
    await pool.query("delete from usuarios where id = any($1)", [ids]); // sesiones y cuentas caen en cascada
    for (const ruta of rutas) await del(ruta).catch(() => {});
  } finally {
    await pool.end();
  }
}
