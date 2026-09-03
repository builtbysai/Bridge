import { createHmac } from "node:crypto";

export type TurnCredentialBundle = {
  urls: string[];
  username: string;
  credential: string;
  expiresAt: number;
};

export const createTurnCredentialBundle = (
  urls: readonly string[],
  sharedSecret: string,
  ttlSeconds: number,
  nowMs = Date.now(),
): TurnCredentialBundle => {
  if (urls.length === 0) throw new Error("At least one TURN URL is required.");
  if (!sharedSecret) throw new Error("A TURN shared secret is required.");
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) throw new Error("TURN credential TTL must be a positive integer.");
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("Current time must be a non-negative safe integer.");

  const expiresAtSeconds = Math.floor(nowMs / 1000) + ttlSeconds;
  const username = `${expiresAtSeconds}:bridge`;
  const credential = createHmac("sha1", sharedSecret).update(username, "utf8").digest("base64");

  return {
    urls: [...urls],
    username,
    credential,
    expiresAt: expiresAtSeconds * 1000,
  };
};
