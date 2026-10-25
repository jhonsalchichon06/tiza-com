import { describe, expect, it } from "vitest";
import { detectarTipoImagen } from "./firmas";

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe("detectarTipoImagen", () => {
  it("reconoce JPEG, PNG y WebP por sus bytes iniciales", () => {
    expect(detectarTipoImagen(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe("image/jpeg");
    expect(detectarTipoImagen(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe("image/png");
    expect(detectarTipoImagen(bytes(...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8 ")))).toBe("image/webp");
  });

  it("rechaza un PDF y un ejecutable aunque se llamen .png", () => {
    expect(detectarTipoImagen(bytes(...ascii("%PDF-1.7\n")))).toBeNull();
    expect(detectarTipoImagen(bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0))).toBeNull(); // "MZ": ejecutable de Windows
    expect(detectarTipoImagen(bytes(0x7f, 0x45, 0x4c, 0x46))).toBeNull(); // ELF
  });

  it("rechaza un RIFF que no es WebP (por ejemplo, un WAV o un AVI)", () => {
    expect(detectarTipoImagen(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")))).toBeNull();
    expect(detectarTipoImagen(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("AVI ")))).toBeNull();
  });

  it("rechaza un GIF", () => {
    expect(detectarTipoImagen(bytes(...ascii("GIF89a")))).toBeNull();
  });

  it("rechaza un buffer vacío o más corto que la firma", () => {
    expect(detectarTipoImagen(new Uint8Array(0))).toBeNull();
    expect(detectarTipoImagen(bytes(0xff, 0xd8))).toBeNull();
    expect(detectarTipoImagen(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(detectarTipoImagen(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEB")))).toBeNull();
  });
});
