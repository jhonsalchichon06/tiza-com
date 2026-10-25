import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { reservaActiva, reservaQueCuentaParaGratis } from "./reservas-activas";

const sqlDe = (fragmento: Parameters<PgDialect["sqlToQuery"]>[0]) => new PgDialect().sqlToQuery(fragmento);

describe("reservaQueCuentaParaGratis", () => {
  const { sql, params } = sqlDe(reservaQueCuentaParaGratis);

  it("incluye la confirmada, la completada y la pendiente cuyo plazo no venció", () => {
    expect(params).toEqual(expect.arrayContaining(["confirmada", "completada", "pendiente"]));
    expect(sql).toContain('"reservas"."expira_en" > now()');
  });

  it("no incluye cancelada ni expirada", () => {
    expect(params).not.toContain("cancelada");
    expect(params).not.toContain("expirada");
  });

  it("reutiliza la condición de reservaActiva en vez de repetirla", () => {
    expect(sql).toContain(sqlDe(reservaActiva).sql);
  });
});
