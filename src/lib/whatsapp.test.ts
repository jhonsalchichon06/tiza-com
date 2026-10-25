import { describe, expect, it } from "vitest";
import { enlaceWhatsApp } from "./whatsapp";

describe("enlaceWhatsApp", () => {
  it("arma el enlace con el mensaje codificado", () => {
    const e = enlaceWhatsApp("51912345678");
    expect(e?.startsWith("https://wa.me/51912345678?text=")).toBe(true);
    expect(e).toContain(encodeURIComponent("Hola Tiza"));
  });
  it.each([undefined, "", "  ", "+51912345678", "5191abc", "51 912"])("sin enlace con %j", (n) => {
    expect(enlaceWhatsApp(n)).toBeNull();
  });
});
