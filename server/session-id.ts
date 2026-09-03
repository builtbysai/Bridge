import { randomUUID } from "node:crypto";

export const SESSION_ID_HEX_LENGTH = 12;
export const MAX_SESSION_ID_ALLOCATION_ATTEMPTS = 32;

type IsSessionIdInUse = (sessionId: string) => boolean;
type SessionIdCandidateFactory = () => string;

const randomSessionIdCandidate = (): string =>
  randomUUID().replaceAll("-", "").slice(0, SESSION_ID_HEX_LENGTH);

/**
 * Allocate a rendezvous ID without ever replacing an existing live session.
 *
 * Session IDs are intentionally short because they are carried in pairing URLs,
 * while the high-entropy fragment secret provides authentication. A random
 * collision must therefore be retried rather than allowing Map#set to overwrite
 * an unrelated live session. The retry bound also fails closed if the random
 * source is unexpectedly unhealthy.
 */
export const allocateSessionId = (
  isInUse: IsSessionIdInUse,
  nextCandidate: SessionIdCandidateFactory = randomSessionIdCandidate,
): string | null => {
  for (let attempt = 0; attempt < MAX_SESSION_ID_ALLOCATION_ATTEMPTS; attempt += 1) {
    const candidate = nextCandidate().toLowerCase();
    if (!/^[0-9a-f]{12}$/.test(candidate)) {
      throw new Error("session ID candidate must be exactly 12 hexadecimal characters");
    }
    if (!isInUse(candidate)) return candidate;
  }

  return null;
};
