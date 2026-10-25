// Uso: npm run admin:promover -- <correo>
// Convierte en administrador a una cuenta ya registrada. Necesita DATABASE_URL (en .env.local).
import { config } from "dotenv";
import { promoverAdmin } from "@/lib/promover-admin";

// db() lee DATABASE_URL recién al usarse, así que basta cargar .env.local antes de llamar.
config({ path: ".env.local", quiet: true });

async function main() {
  try {
    const correo = await promoverAdmin(process.argv[2] ?? "");
    console.log(`Listo: ${correo} ahora es administrador.`);
    process.exit(0);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

void main();
