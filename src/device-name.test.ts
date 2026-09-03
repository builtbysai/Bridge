import { describe, expect, it } from "vitest";
import { defaultDeviceName, displayDeviceName, loadDeviceName, MAX_DEVICE_NAME_LENGTH, normalizeDeviceName, saveDeviceName } from "./device-name";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("device naming", () => {
  it("normalizes whitespace, strips control characters, and bounds length", () => {
    const value = `  Alice\u0000   Laptop ${"x".repeat(80)}  `;
    const normalized = normalizeDeviceName(value);
    expect(normalized.startsWith("Alice Laptop ")).toBe(true);
    expect(normalized).not.toContain("\u0000");
    expect(normalized.length).toBe(MAX_DEVICE_NAME_LENGTH);
  });

  it("persists and clears a local custom name", () => {
    const storage = new MemoryStorage();
    expect(saveDeviceName("  Studio   Mac  ", storage)).toBe("Studio Mac");
    expect(loadDeviceName(storage)).toBe("Studio Mac");
    expect(saveDeviceName("   ", storage)).toBe("");
    expect(loadDeviceName(storage)).toBe("");
  });

  it("falls back to a coarse local device label", () => {
    const storage = new MemoryStorage();
    expect(defaultDeviceName("Mozilla/5.0 (iPhone)")).toBe("This iPhone");
    expect(defaultDeviceName("Mozilla/5.0 (Windows NT 10.0)")).toBe("This Windows PC");
    expect(displayDeviceName(storage, "Mozilla/5.0 (X11; Linux x86_64)")).toBe("This Linux device");
  });
});
