import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/esquema.ts",
  out: "./src/db/migraciones",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
