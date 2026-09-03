import { describe, expect, it } from "vitest";
import {
  createKeyConfirmationProof,
  derivePairingVerifier,
  verifyKeyConfirmationProof
} from "./pairing-auth";

const secret = "11".repeat(32);
const otherSecret = "22".repeat(32);
const sessionId = "session-123";

describe("pairing authentication", () => {
  it("derives a stable rendezvous verifier without exposing the raw secret", async () => {
    const verifier = await derivePairingVerifier(secret);
    expect(verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(verifier).not.toContain(secret);
    expect(await derivePairingVerifier(secret)).toBe(verifier);
  });

  it("accepts only a proof from the expected role, session, and secret", async () => {
    const hostProof = await createKeyConfirmationProof(secret, sessionId, "host");

    await expect(verifyKeyConfirmationProof(secret, sessionId, "host", hostProof)).resolves.toBe(true);
    await expect(verifyKeyConfirmationProof(secret, sessionId, "guest", hostProof)).resolves.toBe(false);
    await expect(verifyKeyConfirmationProof(secret, "different-session", "host", hostProof)).resolves.toBe(false);
    await expect(verifyKeyConfirmationProof(otherSecret, sessionId, "host", hostProof)).resolves.toBe(false);
  });

  it("rejects malformed proofs instead of throwing", async () => {
    await expect(verifyKeyConfirmationProof(secret, sessionId, "guest", "not-hex")).resolves.toBe(false);
  });
});
