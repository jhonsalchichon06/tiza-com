import { describe, expect, it } from "vitest";
import { ErrorApi } from "../errores";
import { MENSAJE_GRATIS_DEL_CLIENTE_USADA, MENSAJE_GRATIS_DEL_HOGAR_USADA, MENSAJE_PAGO_EN_REVISION, MENSAJE_PAGO_YA_REEMPLAZADO, MENSAJE_PAGO_YA_USADO, MENSAJE_RESERVA_EN_ESPERA, traducirUnicidad } from "./unicidad";

const conCausa = (code: string, constraint?: string) => Object.assign(new Error("Failed query"), { cause: { code, constraint } });

describe("traducirUnicidad", () => {
  it.each([
    ["membresias_una_pendiente_por_cliente", MENSAJE_PAGO_EN_REVISION],
    ["reservas_una_pendiente_por_cliente", MENSAJE_RESERVA_EN_ESPERA],
    ["reservas_un_pago_por_reserva_viva", MENSAJE_PAGO_YA_USADO],
    ["pagos_un_reemplazo_por_pago", MENSAJE_PAGO_YA_REEMPLAZADO],
  ])("convierte %s en un 409 con el código en_espera", (indice, mensaje) => {
    const traducido = traducirUnicidad(conCausa("23505", indice));
    expect(traducido).toBeInstanceOf(ErrorApi);
    expect(traducido).toMatchObject({ status: 409, codigo: "en_espera", message: mensaje });
  });

  it.each([
    ["reservas_primera_gratis_por_hogar", MENSAJE_GRATIS_DEL_HOGAR_USADA],
    ["reservas_primera_gratis_por_cliente", MENSAJE_GRATIS_DEL_CLIENTE_USADA],
  ])("convierte %s en un 409 con el código limpieza_gratis_usada", (indice, mensaje) => {
    const traducido = traducirUnicidad(conCausa("23505", indice));
    expect(traducido).toBeInstanceOf(ErrorApi);
    expect(traducido).toMatchObject({ status: 409, codigo: "limpieza_gratis_usada", message: mensaje });
  });

  it("no traduce los índices de la gratis con otro código de error", () => {
    const error = conCausa("23514", "reservas_primera_gratis_por_hogar");
    expect(traducirUnicidad(error)).toBe(error);
  });

  it("deja pasar un error sin causa", () => {
    const error = new Error("otro");
    expect(traducirUnicidad(error)).toBe(error);
    expect(traducirUnicidad("texto")).toBe("texto");
    expect(traducirUnicidad(undefined)).toBeUndefined();
  });

  it("deja pasar otra restricción única", () => {
    const error = conCausa("23505", "usuarios_email_unique");
    expect(traducirUnicidad(error)).toBe(error);
  });

  it("deja pasar otro código aunque la restricción coincida", () => {
    const error = conCausa("23514", "membresias_una_pendiente_por_cliente");
    expect(traducirUnicidad(error)).toBe(error);
  });

  it("deja pasar un 23505 sin nombre de restricción", () => {
    const error = conCausa("23505");
    expect(traducirUnicidad(error)).toBe(error);
  });
});
