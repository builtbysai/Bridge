const encoder = new TextEncoder();

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");

const bytesFromHex = (value: string): Uint8Array<ArrayBuffer> => {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error("Invalid hexadecimal key material");
  }
  return Uint8Array.from(value.match(/.{2}/g) ?? [], pair => Number.parseInt(pair, 16));
};

export const sha256Hex = async (data: BufferSource): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return hex(new Uint8Array(digest));
};

export const deriveSessionKey = async (secretHex: string, sessionId: string): Promise<CryptoKey> => {
  const secret = bytesFromHex(secretHex);
  if (secret.byteLength < 32) throw new Error("Pairing secret must contain at least 256 bits");

  const keyMaterial = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(`bridge:${sessionId}`),
      info: encoder.encode("bridge-transfer-v1")
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

/**
 * Compose a 128-bit GCM IV from a 96-bit random transfer nonce and a 32-bit
 * chunk counter. The larger per-transfer nonce materially reduces the chance
 * of IV reuse under one temporary session key compared with the old 64-bit
 * transfer nonce. Bridge rejects transfers large enough to overflow the
 * 32-bit chunk counter before they can be sent.
 */
const chunkIv = (transferNonce: Uint8Array, chunkIndex: number): Uint8Array<ArrayBuffer> => {
  if (transferNonce.byteLength !== 12) throw new Error("Transfer nonce must be 12 bytes");
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 0xffff_ffff) {
    throw new Error("Chunk index is outside the supported AES-GCM IV range");
  }
  const iv = new Uint8Array(16);
  iv.set(transferNonce, 0);
  new DataView(iv.buffer).setUint32(12, chunkIndex, false);
  return iv;
};

export const encryptChunk = async (
  key: CryptoKey,
  transferNonce: Uint8Array,
  chunkIndex: number,
  plaintext: BufferSource,
  associatedData: string
): Promise<ArrayBuffer> => crypto.subtle.encrypt(
  {
    name: "AES-GCM",
    iv: chunkIv(transferNonce, chunkIndex),
    additionalData: encoder.encode(associatedData),
    tagLength: 128
  },
  key,
  plaintext
);

export const decryptChunk = async (
  key: CryptoKey,
  transferNonce: Uint8Array,
  chunkIndex: number,
  ciphertext: BufferSource,
  associatedData: string
): Promise<ArrayBuffer> => crypto.subtle.decrypt(
  {
    name: "AES-GCM",
    iv: chunkIv(transferNonce, chunkIndex),
    additionalData: encoder.encode(associatedData),
    tagLength: 128
  },
  key,
  ciphertext
);

export const randomTransferNonce = (): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(12));

export const bytesToHex = hex;
export { bytesFromHex };
