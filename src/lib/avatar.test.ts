import { describe, expect, it } from "vitest";
import { AVATAR_MAX_LENGTH, centerSquare, isAvatar } from "./avatar";

describe("profilová fotka", () => {
  it("výřez je čtverec ze středu", () => {
    expect(centerSquare(4000, 3000)).toEqual({ x: 500, y: 0, size: 3000 });
    expect(centerSquare(1080, 1920)).toEqual({ x: 0, y: 420, size: 1080 });
    expect(centerSquare(256, 256)).toEqual({ x: 0, y: 0, size: 256 });
  });

  /* Fotka se synchronizuje přes nastavení - z jiného zařízení nebo starší
     verze může přijít cokoli, appka ukáže jen opravdový malý obrázek. */
  it("vezme jen malý obrázek jako data URI", () => {
    expect(isAvatar("data:image/jpeg;base64,/9j/4AAQSkZJRg==")).toBe(true);
    expect(isAvatar("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isAvatar("https://example.cz/fotka.jpg")).toBe(false);
    expect(isAvatar("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isAvatar(`data:image/jpeg;base64,${"A".repeat(AVATAR_MAX_LENGTH)}`)).toBe(false);
    expect(isAvatar(null)).toBe(false);
  });
});
