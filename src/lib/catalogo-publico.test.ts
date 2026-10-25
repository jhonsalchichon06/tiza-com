import { describe, expect, it } from "vitest";
import { VALORES_DEL_DISENO } from "./__fixtures__/configuracion";
import { construirCatalogo } from "./catalogo-publico";
import type { Configuracion } from "./configuracion";
import { DISTRITOS } from "./distritos";
import { calcularServicio } from "./precios";

const catalogo = (cambios: Partial<Configuracion> = {}) => construirCatalogo({ ...VALORES_DEL_DISENO, ...cambios });

describe("construirCatalogo", () => {
  it("calcula el «desde» con calcularServicio", () => {
    const c = catalogo();
    expect(c.servicios.map((s) => s.desde)).toEqual(["S/ 66", "S/ 99", "S/ 112,20"]);
    for (const s of c.servicios) {
      expect(s.desdeCentimos).toBe(calcularServicio(VALORES_DEL_DISENO, { tipo: s.tipo, dormitorios: 0, banos: 1 }).precio_lista);
    }
  });

  it("precio por hora con decimales y mejor precio solo en el de 8 h", () => {
    const c = catalogo();
    expect(c.paquetes.find((p) => p.horas === 4)?.precioPorHora).toBe("S/ 32,25");
    expect(c.paquetes.filter((p) => p.mejorPrecio).map((p) => p.horas)).toEqual([8]);
  });

  it("deriva las descripciones de los niveles y usa un texto general en 8 h", () => {
    const d = Object.fromEntries(catalogo().paquetes.map((p) => [p.horas, p.descripcion]));
    expect(d[3]).toBe("Cocina, hasta 1 baño y hasta 1 dormitorio.");
    expect(d[4]).toBe("Cocina, hasta 2 baños y hasta 2 dormitorios.");
    expect(d[6]).toBe("Cocina y más de 2 dormitorios o más de 2 baños.");
    expect(d[8]).toBe("Día completo para casas grandes u orden total.");
  });

  it("expone los meses de la membresía y ningún monto", () => {
    const a = catalogo();
    const b = catalogo({ membresia_precio_mensual: 9900 });
    expect(a.membresia.meses).toBe(3);
    expect(b).toEqual(a);
    expect(JSON.stringify(a)).not.toMatch(/S\/ (89|267)|8900|26700/);
  });

  it("cambiar datos cambia el catálogo sin tocar código", () => {
    expect(catalogo({ precios_niveles: [7000, 9900, 12900, 18900] }).servicios[0].desde).toBe("S/ 70");
    expect(catalogo({ descuento_miembro: 0.2 }).descuentoPorcentaje).toBe(20);
    const extra = catalogo({ paquetes_horas: [...VALORES_DEL_DISENO.paquetes_horas, { horas: 5, precio: 15000 }] });
    expect(extra.paquetes.map((p) => p.horas)).toContain(5);
    const niveles = [
      ...VALORES_DEL_DISENO.niveles_hogar.slice(0, 3),
      { max_dormitorios: 4, max_banos: 3, horas: 5 },
      { max_dormitorios: null, max_banos: null, horas: 6 },
    ];
    const conNivel = catalogo({ niveles_hogar: niveles, precios_niveles: [6600, 9900, 12900, 15000, 18900] });
    expect(conNivel.paquetes.find((p) => p.horas === 6)?.descripcion).toBe("Cocina y más de 4 dormitorios o más de 3 baños.");
  });

  it("lista exactamente los 9 distritos de v1", () => {
    expect(catalogo().distritos).toEqual(DISTRITOS);
    expect(catalogo().distritos).toHaveLength(9);
  });
});
