import { describe, expect, it } from "vitest";
import { ErrorApi } from "./errores";
import { claveHogar, normalizarNumero, normalizarTexto, validarDireccion } from "./direccion";

const valida = { distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: "Dpto 302", referencias: "puerta verde" };

const errorDe = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as ErrorApi;
  }
  throw new Error("no lanzó");
};

describe("normalizarTexto", () => {
  it.each(["Av. Larco", "AVENIDA LARCO", "avda larco", "Av Larco"])("%j da avenida larco", (texto) => {
    expect(normalizarTexto(texto)).toBe("avenida larco");
  });

  it.each(["Jr. Junín", "Jirón Junin"])("%j da jiron junin", (texto) => {
    expect(normalizarTexto(texto)).toBe("jiron junin");
  });

  it.each(["Dpto 302", "dpto. 302", "Departamento 302", "DEPTO. 302", "Dep 302"])("%j da dpto 302", (texto) => {
    expect(normalizarTexto(texto)).toBe("dpto 302");
  });

  it.each(["Calle Los Pinos N° 5", "Calle Los Pinos Nº 5", "Calle Los Pinos # 5"])("%j da nro", (texto) => {
    expect(normalizarTexto(texto)).toBe("calle los pinos nro 5");
  });

  it("solo cambia palabras completas", () => {
    expect(normalizarTexto("Avenida")).toBe("avenida");
    expect(normalizarTexto("Calle Avellana")).toBe("calle avellana");
    expect(normalizarTexto("Pasaje Jrock")).toBe("pasaje jrock");
  });

  it("es idempotente", () => {
    const muestra = ["Av. Larco", "Jr. Junín N° 45", "Dpto. 302-B", "  Calle   La Peña  #7 ", "ÁÉÍÓÚ ñandú", "Departamento 12"];
    for (const texto of muestra) {
      expect(normalizarTexto(normalizarTexto(texto))).toBe(normalizarTexto(texto));
    }
  });
});

describe("normalizarNumero", () => {
  it.each(["123-A", "N° 123 A", "123 a", "123A"])("%j da 123a", (numero) => {
    expect(normalizarNumero(numero)).toBe("123a");
  });

  it("es idempotente", () => {
    expect(normalizarNumero(normalizarNumero("N° 45 B"))).toBe("45b");
  });
});

describe("validarDireccion", () => {
  it.each([["La Molina"], [undefined], [""], ["   "], ["miraflores"]])("rechaza el distrito %j con 422", (distrito) => {
    const error = errorDe(() => validarDireccion({ ...valida, distrito }));
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/distritos que atendemos/);
  });

  it.each([[""], ["   "], [".."], [undefined]])("rechaza la calle %j con 422", (calle) => {
    const error = errorDe(() => validarDireccion({ ...valida, calle }));
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/calle, avenida o jirón/);
  });

  it.each([["s/n"], ["abc"], [""], [undefined]])("rechaza el número %j con 422", (numero) => {
    const error = errorDe(() => validarDireccion({ ...valida, numero }));
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/número/);
  });

  it("acepta el número 123-A", () => {
    expect(validarDireccion({ ...valida, numero: "123-A" }).numero).toBe("123-A");
  });

  it("rechaza los campos demasiado largos", () => {
    expect(errorDe(() => validarDireccion({ ...valida, calle: "a".repeat(101) })).message).toMatch(/calle es demasiado larga/);
    expect(errorDe(() => validarDireccion({ ...valida, numero: "1".repeat(21) })).message).toMatch(/número es demasiado largo/);
    expect(errorDe(() => validarDireccion({ ...valida, departamento: "1".repeat(31) })).message).toMatch(/departamento es demasiado largo/);
    expect(errorDe(() => validarDireccion({ ...valida, referencias: "a".repeat(201) })).message).toMatch(/referencias son demasiado largas/);
  });

  it("acepta una casa sin departamento ni referencias", () => {
    for (const vacio of [undefined, null, "", "   "]) {
      const d = validarDireccion({ distrito: "Barranco", calle: "Jr. Junín", numero: "45", departamento: vacio, referencias: vacio });
      expect(d.departamento).toBeNull();
      expect(d.referencias).toBeNull();
      expect(d.departamentoNormalizado).toBe("");
    }
    const sinCampos = validarDireccion({ distrito: "Barranco", calle: "Jr. Junín", numero: "45" });
    expect(sinCampos.departamento).toBeNull();
  });

  it("guarda lo escrito, recortado, junto con lo normalizado", () => {
    const d = validarDireccion({ ...valida, calle: " Av. Larco ", departamento: " Dpto. 302 " });
    expect(d).toEqual({
      distrito: "Miraflores",
      calle: "Av. Larco",
      numero: "123",
      departamento: "Dpto. 302",
      referencias: "puerta verde",
      direccionNormalizada: "avenida larco 123",
      departamentoNormalizado: "dpto 302",
    });
  });

  it("no devuelve coordenadas ni identificador de lugar", () => {
    const claves = Object.keys(validarDireccion({ ...valida, latitud: -12.1, longitud: -77, place_id: "x" }));
    expect(claves).not.toEqual(expect.arrayContaining(["latitud"]));
    for (const prohibida of ["latitud", "longitud", "place_id", "placeId"]) expect(claves).not.toContain(prohibida);
  });
});

describe("claveHogar", () => {
  const clave = (cambio: Record<string, unknown> = {}) => claveHogar(validarDireccion({ ...valida, ...cambio }));

  it("es la misma para el mismo hogar escrito de otra forma", () => {
    expect(clave({ calle: "Avenida LARCO", departamento: "dpto. 302" })).toEqual(clave());
  });

  it("distingue departamentos, con y sin departamento, y distritos", () => {
    expect(clave({ departamento: "Dpto 303" })).not.toEqual(clave());
    expect(clave({ departamento: undefined })).not.toEqual(clave());
    expect(clave({ distrito: "Barranco" })).not.toEqual(clave());
  });

  it("no cambia con las referencias", () => {
    expect(clave({ referencias: undefined })).toEqual(clave());
    expect(clave({ referencias: "frente al parque" })).toEqual(clave());
    expect(Object.keys(clave())).toEqual(["distrito", "direccionNormalizada", "departamentoNormalizado"]);
  });

  it("no unifica 'Av. Larco 123' con 'Larco 123' (límite conocido, ADR 0013)", () => {
    expect(clave({ calle: "Larco" })).not.toEqual(clave({ calle: "Av. Larco" }));
  });
});
