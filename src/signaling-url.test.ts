import { describe, expect, it } from "vitest";
import { signalingUrlForEnvironment } from "./signaling-url";

const httpLocation = { protocol: "http:", hostname: "localhost" } as Location;
const httpsLocation = { protocol: "https:", hostname: "bridge.example" } as Location;

describe("signalingUrlForEnvironment", () => {
  it("keeps the localhost development fallback on HTTP", () => {
    expect(signalingUrlForEnvironment(undefined, httpLocation)).toBe("ws://localhost:8787/signal");
  });

  it("requires an explicit signaling URL on HTTPS deployments", () => {
    expect(() => signalingUrlForEnvironment(undefined, httpsLocation)).toThrow(/VITE_SIGNALING_URL is required/);
  });

  it("requires WSS when the Bridge page is HTTPS", () => {
    expect(() => signalingUrlForEnvironment("ws://signal.example/signal", httpsLocation)).toThrow(/require a secure wss:/);
  });

  it("accepts a canonical secure production signaling endpoint", () => {
    expect(signalingUrlForEnvironment("wss://signal.example/signal", httpsLocation)).toBe("wss://signal.example/signal");
  });

  it.each([
    "https://signal.example/signal",
    "wss://user:secret@signal.example/signal",
    "wss://signal.example/other",
    "wss://signal.example/signal?token=secret",
    "wss://signal.example/signal#secret",
  ])("rejects unsafe or ambiguous signaling URL %s", value => {
    expect(() => signalingUrlForEnvironment(value, httpsLocation)).toThrow();
  });
});
