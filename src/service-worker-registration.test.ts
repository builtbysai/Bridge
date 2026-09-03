import { afterEach, describe, expect, it, vi } from "vitest";
import { registerBridgeServiceWorker } from "./service-worker-registration";

describe("registerBridgeServiceWorker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not register the production worker in development", async () => {
    const register = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { register } });

    await expect(registerBridgeServiceWorker(false)).resolves.toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it("registers the production worker with cache-bypassed update checks", async () => {
    const registration = {} as ServiceWorkerRegistration;
    const register = vi.fn().mockResolvedValue(registration);
    vi.stubGlobal("navigator", { serviceWorker: { register } });

    await expect(registerBridgeServiceWorker(true)).resolves.toBe(registration);
    expect(register).toHaveBeenCalledWith("/sw.js", { updateViaCache: "none" });
  });

  it("fails softly when service workers are unsupported", async () => {
    vi.stubGlobal("navigator", {});

    await expect(registerBridgeServiceWorker(true)).resolves.toBeNull();
  });

  it("fails softly when registration is rejected", async () => {
    const register = vi.fn().mockRejectedValue(new Error("registration failed"));
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(registerBridgeServiceWorker(true)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});
