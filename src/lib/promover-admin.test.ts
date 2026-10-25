import { describe, expect, it, vi } from "vitest";
import { promoverAdmin } from "./promover-admin";

vi.mock("@/db/cliente", () => ({ db: () => { throw new Error("no debe tocar la base real"); } }));

describe("promoverAdmin", () => {
  it("promueve una cuenta existente con el correo normalizado", async () => {
    const promover = vi.fn().mockResolvedValue(true);
    await expect(promoverAdmin("  Ana@Correo.COM ", promover)).resolves.toBe("ana@correo.com");
    expect(promover).toHaveBeenCalledWith("ana@correo.com");
  });

  it("falla sin crear nada cuando el correo no tiene cuenta", async () => {
    const promover = vi.fn().mockResolvedValue(false);
    await expect(promoverAdmin("nadie@correo.com", promover)).rejects.toThrow(/No existe una cuenta con el correo nadie@correo.com/);
    expect(promover).toHaveBeenCalledTimes(1);
  });

  it("pide el correo si no se indica", async () => {
    await expect(promoverAdmin("", vi.fn())).rejects.toThrow(/admin:promover/);
  });
});
