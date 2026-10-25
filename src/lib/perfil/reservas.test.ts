import { describe, expect, it } from "vitest";
import { crearBdDoble } from "./__dobles__/bd-doble";
import { dentroDelPlazo, estadoEfectivo, listarHistorial, listarProximas, LIMITE_HISTORIAL, type FilaVista } from "./reservas";

const CONFIG = { cancelacion_minima_horas: 24, horario_atencion: { dias: [1, 2, 3, 4, 5, 6], apertura: "08:00", cierre: "18:00", zona: "America/Lima" } };
const AHORA = new Date("2026-11-02T15:00:00Z");
const enHoras = (h: number) => new Date(AHORA.getTime() + h * 3_600_000);

const fila = (extra: Partial<FilaVista> = {}): FilaVista => ({
  id: "r1",
  estado: "confirmada",
  tipo: "estandar",
  dormitorios: 2,
  banos: 1,
  horasTrabajo: "4.0",
  requiereApoyo: false,
  distrito: "Miraflores",
  calle: "Av. Larco",
  numero: "123",
  departamento: "501",
  referencias: null,
  inicio: enHoras(24 * 5),
  fin: enHoras(24 * 5 + 4),
  precioLista: 12900,
  horasGratisAplicadas: "0.0",
  monto: 11610,
  expiraEn: null,
  vencida: false,
  yaEmpezo: false,
  ...extra,
});

describe("dentroDelPlazo", () => {
  it("exactamente 24 horas: permitido", () => expect(dentroDelPlazo(CONFIG, AHORA, enHoras(24))).toBe(true));
  it("23 h 59 min: no permitido", () => expect(dentroDelPlazo(CONFIG, AHORA, new Date(enHoras(24).getTime() - 60_000))).toBe(false));
  it("el plazo es un dato: con 12 horas, 13 h antes sí y 11 h antes no", () => {
    const c = { cancelacion_minima_horas: 12 };
    expect(dentroDelPlazo(c, AHORA, enHoras(13))).toBe(true);
    expect(dentroDelPlazo(c, AHORA, enHoras(11))).toBe(false);
  });
});

describe("listarProximas", () => {
  it("confirmada futura: con banderas verdaderas, dirección tal como se escribió y fechas en hora de Lima", async () => {
    const doble = crearBdDoble({ reservas: [[fila()]] });
    const [p] = await listarProximas(doble.base, "u1", CONFIG, AHORA);
    expect(p).toMatchObject({
      id: "r1",
      estado: "confirmada",
      estado_texto: "Confirmada",
      puede_reprogramar: true,
      puede_cancelar: true,
      servicio: { tipo: "estandar", dormitorios: 2, banos: 1 },
      direccion: { distrito: "Miraflores", calle: "Av. Larco", numero: "123", departamento: "501" },
      monto: 11610,
      precio_lista: 12900,
      horas_gratis_aplicadas: 0,
      requiere_apoyo: false,
      expira_en: null,
      enlace: "/cuenta/reservas/r1",
    });
    expect(p.inicio).toBe("2026-11-07T10:00:00-05:00");
  });

  it("pendiente vigente: texto de espera y hora límite", async () => {
    const doble = crearBdDoble({ reservas: [[fila({ estado: "pendiente", expiraEn: enHoras(10) })]] });
    const [p] = await listarProximas(doble.base, "u1", CONFIG, AHORA);
    expect(p.estado).toBe("pendiente");
    expect(p.estado_texto).toBe("Esperando la aprobación de tu pago");
    expect(p.expira_en).toBe("2026-11-02T20:00:00-05:00");
  });

  it("paquete: sin tamaño, con horas", async () => {
    const doble = crearBdDoble({ reservas: [[fila({ tipo: "paquete", dormitorios: null, banos: null, horasTrabajo: "6.0" })]] });
    const [p] = await listarProximas(doble.base, "u1", CONFIG, AHORA);
    expect(p.servicio).toEqual({ tipo: "paquete", horas: 6 });
  });

  it("a menos de 24 horas: ni reprogramar ni cancelar", async () => {
    const doble = crearBdDoble({ reservas: [[fila({ inicio: new Date(enHoras(24).getTime() - 60_000) })]] });
    const [p] = await listarProximas(doble.base, "u1", CONFIG, AHORA);
    expect(p.puede_reprogramar).toBe(false);
    expect(p.puede_cancelar).toBe(false);
  });

  it("exactamente 24 horas: todavía se permite", async () => {
    const doble = crearBdDoble({ reservas: [[fila({ inicio: enHoras(24) })]] });
    const [p] = await listarProximas(doble.base, "u1", CONFIG, AHORA);
    expect(p.puede_cancelar).toBe(true);
  });

  it("conserva el orden que entrega la consulta (ascendente) y la pide ordenada y con el reloj de la base", async () => {
    const doble = crearBdDoble({ reservas: [[fila({ id: "a" }), fila({ id: "b" }), fila({ id: "c" })]] });
    const r = await listarProximas(doble.base, "u1", CONFIG, AHORA);
    expect(r.map((x) => x.id)).toEqual(["a", "b", "c"]);
    const [consulta] = doble.lecturas();
    expect(consulta.donde?.sql).toContain('"inicio" > now()');
    expect(consulta.donde?.sql).toContain('"expira_en" > now()');
  });

  it("el filtro lleva el usuario_id de la sesión", async () => {
    const doble = crearBdDoble({ reservas: [[]] });
    await listarProximas(doble.base, "usuario-A", CONFIG, AHORA);
    expect(doble.lecturas()[0].donde?.params).toContain("usuario-A");
  });

  it("la forma no incluye equipo_id ni el nombre del equipo", async () => {
    const doble = crearBdDoble({ reservas: [[{ ...fila(), equipoId: 2 }]] });
    const [p] = await listarProximas(doble.base, "u1", CONFIG, AHORA);
    expect(JSON.stringify(p)).not.toMatch(/equipo/i);
  });
});

describe("listarHistorial", () => {
  it("completada, cancelada y expirada con su estado en español", async () => {
    const doble = crearBdDoble({
      reservas: [[fila({ id: "a", estado: "completada", yaEmpezo: true }), fila({ id: "b", estado: "cancelada" }), fila({ id: "c", estado: "expirada" })]],
    });
    const r = await listarHistorial(doble.base, "u1", CONFIG);
    expect(r.map((x) => x.estado_texto)).toEqual(["Completada", "Cancelada", "Expirada"]);
    expect(r[0].enlace).toBe("/cuenta/reservas/a");
  });

  it("pendiente vencida se muestra expirada (aunque nadie la haya marcado)", async () => {
    const doble = crearBdDoble({ reservas: [[fila({ estado: "pendiente", expiraEn: enHoras(-1), vencida: true })]] });
    const [r] = await listarHistorial(doble.base, "u1", CONFIG);
    expect(r.estado).toBe("expirada");
    expect(r.expira_en).toBeNull();
  });

  it("confirmada cuyo inicio ya pasó: 'Servicio realizado, pendiente de cierre'", async () => {
    const doble = crearBdDoble({ reservas: [[fila({ yaEmpezo: true })]] });
    const [r] = await listarHistorial(doble.base, "u1", CONFIG);
    expect(r.estado_texto).toBe("Servicio realizado, pendiente de cierre");
  });

  it("60 reservas devuelven las 50 primeras y la consulta pide límite 50", async () => {
    const sesenta = Array.from({ length: 60 }, (_, i) => fila({ id: `r${i}` }));
    const doble = crearBdDoble({ reservas: [sesenta] });
    const r = await listarHistorial(doble.base, "u1", CONFIG);
    expect(r).toHaveLength(LIMITE_HISTORIAL);
    expect(r[0].id).toBe("r0");
    expect(doble.lecturas()[0].limite).toBe(50);
  });

  it("filtra por usuario_id y excluye las próximas con la misma condición", async () => {
    const doble = crearBdDoble({ reservas: [[]] });
    await listarHistorial(doble.base, "usuario-A", CONFIG);
    const l = doble.lecturas()[0];
    expect(l.donde?.params).toContain("usuario-A");
    expect(l.donde?.sql).toMatch(/not \(/i);
  });

  it("no incluye equipo_id", async () => {
    const doble = crearBdDoble({ reservas: [[{ ...fila(), equipoId: 1 }]] });
    expect(JSON.stringify(await listarHistorial(doble.base, "u1", CONFIG))).not.toMatch(/equipo/i);
  });
});

describe("estadoEfectivo", () => {
  it.each([
    [{ estado: "pendiente", vencida: false, yaEmpezo: false }, "pendiente"],
    [{ estado: "pendiente", vencida: true, yaEmpezo: false }, "expirada"],
    [{ estado: "confirmada", vencida: false, yaEmpezo: true }, "pendiente_de_cierre"],
    [{ estado: "completada", vencida: false, yaEmpezo: true }, "completada"],
  ] as const)("%j → %s", (f, esperado) => expect(estadoEfectivo(f)).toBe(esperado));
});
