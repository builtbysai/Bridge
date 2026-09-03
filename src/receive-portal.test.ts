import { describe, expect, it } from "vitest";
import { createReceivePortalUrl, isReceivePortalUrl } from "./receive-portal";

describe("receive portal URLs", () => {
  it("creates a portal link without changing the pairing secret fragment", () => {
    const pairing = new URL("https://bridge.example/?session=abc123#key=deadbeef");
    const portal = createReceivePortalUrl(pairing);

    expect(portal.searchParams.get("session")).toBe("abc123");
    expect(portal.searchParams.get("portal")).toBe("receive");
    expect(portal.hash).toBe("#key=deadbeef");
    expect(isReceivePortalUrl(portal)).toBe(true);
  });

  it("rejects incomplete portal URLs", () => {
    expect(isReceivePortalUrl(new URL("https://bridge.example/?portal=receive&session=abc123"))).toBe(false);
    expect(isReceivePortalUrl(new URL("https://bridge.example/?portal=receive#key=deadbeef"))).toBe(false);
    expect(isReceivePortalUrl(new URL("https://bridge.example/?session=abc123#key=deadbeef"))).toBe(false);
  });
});
