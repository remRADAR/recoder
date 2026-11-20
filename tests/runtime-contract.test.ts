import { describe, expect, it } from "vitest";
import { EXECUTION_TIMEOUT_MS, MAX_OUTPUT_BYTES, isSafeProjectPath } from "../shared/runtime";

describe("device-native runtime contract", () => {
  it("uses bounded execution and output limits", () => {
    expect(EXECUTION_TIMEOUT_MS).toBe(5_000);
    expect(MAX_OUTPUT_BYTES).toBe(64_000);
  });

  it("confines local server paths to the active project root", () => {
    expect(isSafeProjectPath("index.html")).toBe(true);
    expect(isSafeProjectPath("assets/app.js")).toBe(true);
    expect(isSafeProjectPath("../secrets.txt")).toBe(false);
    expect(isSafeProjectPath("/etc/passwd")).toBe(false);
    expect(isSafeProjectPath("assets\\secret.txt")).toBe(false);
  });
});
