import { getTableColumns } from "drizzle-orm";
import { getAuthTables } from "better-auth/db";
import { describe, expect, it } from "vitest";
import { opcionesAuth } from "@/lib/auth";
import * as esquema from "./esquema";

// Si una actualización de Better Auth agrega o renombra un campo, esta prueba lo detecta.
describe("esquema de autenticación", () => {
  const tablas = getAuthTables(opcionesAuth);

  it.each(Object.values(tablas).map((t) => [t.modelName, t] as const))(
    "la tabla %s tiene todos los campos que espera Better Auth",
    (nombre, tabla) => {
      const columnas = Object.keys(getTableColumns(esquema[nombre as keyof typeof esquema] as never));
      expect(columnas).toEqual(expect.arrayContaining(["id", ...Object.keys(tabla.fields)]));
    },
  );
});
