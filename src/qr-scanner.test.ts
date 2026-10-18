import { describe, expect, it } from "vitest";
import { parsePairingUrl } from "./qr-scanner";

const SESSION = "a1b2c3d4e5f6";
const SECRET = "0123456789abcdef".repeat(4);
const GOOD = `https://builtbysai.com/Bridge/?session=${SESSION}#key=${SECRET}`;

describe("parsePairingUrl", () => {
  it("accepts a valid Bridge invite URL", () => {
    expect(parsePairingUrl(GOOD)).toEqual({ session: SESSION, secret: SECRET });
  });

  it("lowercases hex and tolerates surrounding whitespace", () => {
    const upper = `https://builtbysai.com/Bridge/?session=${SESSION.toUpperCase()}#key=${SECRET.toUpperCase()}`;
    const parsed = parsePairingUrl(`  ${upper} \n`);
    expect(parsed).toEqual({ session: SESSION, secret: SECRET });
  });

  it("rejects non-URLs and empty input", () => {
    expect(parsePairingUrl("")).toBeNull();
    expect(parsePairingUrl("   ")).toBeNull();
    expect(parsePairingUrl("not a url")).toBeNull();
  });

  it("rejects URLs without a valid session", () => {
    expect(parsePairingUrl(`https://builtbysai.com/Bridge/#key=${SECRET}`)).toBeNull();
    expect(parsePairingUrl(`https://builtbysai.com/Bridge/?session=xyz#key=${SECRET}`)).toBeNull();
  });

  it("rejects URLs without a valid key", () => {
    expect(parsePairingUrl(`https://builtbysai.com/Bridge/?session=${SESSION}`)).toBeNull();
    expect(
      parsePairingUrl(`https://builtbysai.com/Bridge/?session=${SESSION}#key=tooshort`),
    ).toBeNull();
  });

  it("rejects unrelated QR payloads", () => {
    expect(parsePairingUrl("https://example.com/")).toBeNull();
    expect(parsePairingUrl("WIFI:S:Cafe;T:WPA;P:secret;;")).toBeNull();
  });
});
