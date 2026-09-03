import { bytesFromHex, bytesToHex } from "./crypto";

const encoder = new TextEncoder();

const secretBytes = (secretHex: string): Uint8Array<ArrayBuffer> => {
  const secret = bytesFromHex(secretHex);
  if (secret.byteLength < 32) throw new Error("Pairing secret must contain at least 256 bits");
  return secret;
};

export type ConfirmationRole = "host" | "guest";

/**
 * Opaque verifier used only for rendezvous admission. The raw QR secret never
 * needs to be sent to the signaling service.
 */
export const derivePairingVerifier = async (secretHex: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", secretBytes(secretHex));
  return bytesToHex(new Uint8Array(digest));
};

const deriveConfirmationKey = async (secretHex: string, sessionId: string): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey("raw", secretBytes(secretHex), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(`bridge:${sessionId}`),
      info: encoder.encode("bridge-key-confirm-v1")
    },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"]
  );
};

const confirmationMessage = (sessionId: string, role: ConfirmationRole): Uint8Array<ArrayBuffer> =>
  encoder.encode(`bridge-key-confirm:v1:${sessionId}:${role}`);

export const createKeyConfirmationProof = async (
  secretHex: string,
  sessionId: string,
  role: ConfirmationRole
): Promise<string> => {
  const key = await deriveConfirmationKey(secretHex, sessionId);
  const signature = await crypto.subtle.sign("HMAC", key, confirmationMessage(sessionId, role));
  return bytesToHex(new Uint8Array(signature));
};

export const verifyKeyConfirmationProof = async (
  secretHex: string,
  sessionId: string,
  role: ConfirmationRole,
  proofHex: string
): Promise<boolean> => {
  let proof: Uint8Array<ArrayBuffer>;
  try {
    proof = bytesFromHex(proofHex);
  } catch {
    return false;
  }
  const key = await deriveConfirmationKey(secretHex, sessionId);
  return crypto.subtle.verify("HMAC", key, proof, confirmationMessage(sessionId, role));
};
