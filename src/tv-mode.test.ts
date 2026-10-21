import { describe, expect, it } from "vitest";
import {
  isTvModePreferred,
  resolveTvMode,
  setTvModePreferred,
  shouldAutoAcceptOnTv,
  TV_MODE_STORAGE_KEY
} from "./tv-mode";

const fakeStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); }
  };
};

describe("TV mode preference", () => {
  it("round-trips through storage", () => {
    const storage = fakeStorage();
    expect(isTvModePreferred(storage)).toBe(false);
    setTvModePreferred(true, storage);
    expect(storage.getItem(TV_MODE_STORAGE_KEY)).toBe("true");
    expect(isTvModePreferred(storage)).toBe(true);
    setTvModePreferred(false, storage);
    expect(isTvModePreferred(storage)).toBe(false);
  });
});

describe("resolveTvMode", () => {
  it("lets the URL enable display mode over a stored off", () => {
    expect(resolveTvMode(new URLSearchParams("tv=1"), false)).toBe(true);
    expect(resolveTvMode(new URLSearchParams("tv=true"), false)).toBe(true);
  });

  it("lets the URL disable display mode over a stored on", () => {
    expect(resolveTvMode(new URLSearchParams("tv=0"), true)).toBe(false);
    expect(resolveTvMode(new URLSearchParams("tv=false"), true)).toBe(false);
  });

  it("falls back to the stored preference without an explicit parameter", () => {
    expect(resolveTvMode(new URLSearchParams(""), true)).toBe(true);
    expect(resolveTvMode(new URLSearchParams(""), false)).toBe(false);
    expect(resolveTvMode(new URLSearchParams("session=abc"), true)).toBe(true);
    expect(resolveTvMode(new URLSearchParams("tv=bogus"), true)).toBe(true);
  });
});

describe("shouldAutoAcceptOnTv", () => {
  const limit = 256 * 1024 * 1024;

  it("accepts files and text at or under the memory limit in TV mode", () => {
    expect(shouldAutoAcceptOnTv(true, { kind: "file", size: 1024 }, limit)).toBe(true);
    expect(shouldAutoAcceptOnTv(true, { kind: "file", size: limit }, limit)).toBe(true);
    expect(shouldAutoAcceptOnTv(true, { kind: "text", size: 12 }, limit)).toBe(true);
  });

  it("never auto-accepts outside TV mode", () => {
    expect(shouldAutoAcceptOnTv(false, { kind: "file", size: 1024 }, limit)).toBe(false);
  });

  it("keeps oversize and malformed offers on the manual path", () => {
    expect(shouldAutoAcceptOnTv(true, { kind: "file", size: limit + 1 }, limit)).toBe(false);
    expect(shouldAutoAcceptOnTv(true, { kind: "file", size: -1 }, limit)).toBe(false);
    expect(shouldAutoAcceptOnTv(true, { kind: "file", size: 1.5 }, limit)).toBe(false);
    expect(shouldAutoAcceptOnTv(true, { kind: "file", size: Number.NaN }, limit)).toBe(false);
  });
});
