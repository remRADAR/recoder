import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isWideViewport, meetsTouchTarget, MOBILE_EDITOR_MIN_HEIGHT, MOBILE_TOUCH_TARGET, MOBILE_WIDE_BREAKPOINT } from "../lib/ui/mobile-layout";

const shellSource = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");

describe("mobile viewport scaling", () => {
  it("keeps phone and tablet widths in the narrow layout until the wide breakpoint", () => {
    expect([320, 375, 390, 414, 599, 799].every((width) => !isWideViewport(width))).toBe(true);
    expect([800, 834, 1024, 1366].every((width) => isWideViewport(width))).toBe(true);
    expect(MOBILE_WIDE_BREAKPOINT).toBe(800);
    expect(isWideViewport(Number.NaN)).toBe(false);
  });

  it("preserves a usable minimum editor height across narrow viewports", () => {
    expect(MOBILE_EDITOR_MIN_HEIGHT).toBeGreaterThanOrEqual(320);
    expect(shellSource).toContain("minHeight: MOBILE_EDITOR_MIN_HEIGHT");
  });
});

describe("mobile touch-target sizing", () => {
  it("uses the 44pt minimum as an inclusive boundary", () => {
    expect(MOBILE_TOUCH_TARGET).toBe(44);
    expect(meetsTouchTarget(44, 44)).toBe(true);
    expect(meetsTouchTarget(48, 44)).toBe(true);
    expect(meetsTouchTarget(43, 44)).toBe(false);
    expect(meetsTouchTarget(44, 43)).toBe(false);
  });

  it("wires the minimum into the shell's primary interactive surfaces", () => {
    expect(shellSource).toContain("height: MOBILE_TOUCH_TARGET");
    expect(shellSource).toContain("minHeight: MOBILE_TOUCH_TARGET");
    expect(shellSource).toContain("minWidth: MOBILE_TOUCH_TARGET");
    for (const label of ["Open file explorer", "Open AI settings", "Open command palette", "Editor actions"]) {
      expect(shellSource).toContain(`accessibilityLabel=\"${label}\"`);
    }
  });
});
