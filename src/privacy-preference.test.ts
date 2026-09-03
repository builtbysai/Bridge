import { describe, expect, it } from "vitest";
import { RELAY_ONLY_STORAGE_KEY, isRelayOnlyPreferred, setRelayOnlyPreferred } from "./privacy-preference";

describe("relay-only privacy preference", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(isRelayOnlyPreferred({ getItem: () => null })).toBe(false);
    expect(isRelayOnlyPreferred({ getItem: key => key === RELAY_ONLY_STORAGE_KEY ? "false" : null })).toBe(false);
  });

  it("reads an explicit enabled preference", () => {
    expect(isRelayOnlyPreferred({ getItem: key => key === RELAY_ONLY_STORAGE_KEY ? "true" : null })).toBe(true);
  });

  it("persists the selected mode", () => {
    let stored = "";
    setRelayOnlyPreferred(true, { setItem: (key, value) => { stored = `${key}:${value}`; } });
    expect(stored).toBe(`${RELAY_ONLY_STORAGE_KEY}:true`);
  });
});
