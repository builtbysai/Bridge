import { signalingUrlForEnvironment } from "./signaling-url";

export type SignalPayload =
  | { description: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit };

export type ObservedConnectionRoute = "direct" | "relayed";

export type SignalingTurnCredentials = {
  urls: string[];
  username: string;
  credential: string;
  expiresAt: number;
};

export type SignalingEvent =
  | { type: "session-created"; sessionId: string; expiresAt: number }
  | { type: "session-joined"; sessionId: string; expiresAt: number }
  | ({ type: "turn-credentials" } & SignalingTurnCredentials)
  | { type: "peer-joined" }
  | { type: "peer-left" }
  | { type: "signal"; payload: SignalPayload }
  | { type: "session-closed"; reason: string }
  | { type: "socket-closed"; code: number; reason: string }
  | { type: "connect-retry"; attempt: number }
  | { type: "error"; code: string };

type Listener = (event: SignalingEvent) => void;

const CONNECT_TIMEOUT_MS = 10_000;
const CONNECT_MAX_ATTEMPTS = 5;
const CONNECT_RETRY_BASE_MS = 1_000;
const CONNECT_RETRY_MAX_MS = 8_000;
const SESSION_ID_PATTERN = /^[a-f0-9]{12}$/;
const MAX_SERVER_TEXT_LENGTH = 512;
const MAX_SDP_LENGTH = 2 * 1024 * 1024;
const MAX_CANDIDATE_LENGTH = 8 * 1024;
const MAX_TURN_URLS = 8;
const SDP_TYPES = new Set<RTCSdpType>(["offer", "answer", "pranswer", "rollback"]);

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
};

const requiredText = (record: Record<string, unknown>, key: string, maxLength = MAX_SERVER_TEXT_LENGTH): string => {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`Invalid signaling field ${key}`);
  }
  return value;
};

const parseSignalPayload = (value: unknown): SignalPayload => {
  const payload = asRecord(value);
  if (Object.hasOwn(payload, "description")) {
    const description = asRecord(payload.description);
    if (typeof description.type !== "string" || !SDP_TYPES.has(description.type as RTCSdpType)) {
      throw new Error("Invalid SDP description type");
    }
    if (description.sdp !== undefined && (typeof description.sdp !== "string" || description.sdp.length > MAX_SDP_LENGTH)) {
      throw new Error("Invalid SDP body");
    }
    return {
      description: {
        type: description.type as RTCSdpType,
        ...(typeof description.sdp === "string" ? { sdp: description.sdp } : {})
      }
    };
  }

  if (Object.hasOwn(payload, "candidate")) {
    const candidate = asRecord(payload.candidate);
    const candidateText = candidate.candidate;
    const lineIndex = candidate.sdpMLineIndex;
    if (candidateText !== undefined && (typeof candidateText !== "string" || candidateText.length > MAX_CANDIDATE_LENGTH)) {
      throw new Error("Invalid ICE candidate");
    }
    if (candidate.sdpMid !== undefined && candidate.sdpMid !== null && typeof candidate.sdpMid !== "string") throw new Error("Invalid ICE sdpMid");
    if (lineIndex !== undefined && lineIndex !== null && (typeof lineIndex !== "number" || !Number.isInteger(lineIndex) || lineIndex < 0)) {
      throw new Error("Invalid ICE sdpMLineIndex");
    }
    if (candidate.usernameFragment !== undefined && candidate.usernameFragment !== null && typeof candidate.usernameFragment !== "string") {
      throw new Error("Invalid ICE usernameFragment");
    }
    return {
      candidate: {
        ...(typeof candidateText === "string" ? { candidate: candidateText } : {}),
        ...(candidate.sdpMid === null || typeof candidate.sdpMid === "string" ? { sdpMid: candidate.sdpMid } : {}),
        ...(lineIndex === null || typeof lineIndex === "number" ? { sdpMLineIndex: lineIndex } : {}),
        ...(candidate.usernameFragment === null || typeof candidate.usernameFragment === "string" ? { usernameFragment: candidate.usernameFragment } : {})
      }
    };
  }

  throw new Error("Unknown signaling payload");
};

const parseTurnCredentials = (record: Record<string, unknown>): SignalingTurnCredentials => {
  if (!Array.isArray(record.urls) || record.urls.length === 0 || record.urls.length > MAX_TURN_URLS) {
    throw new Error("Invalid TURN URL list");
  }
  const urls = record.urls.map(value => {
    if (typeof value !== "string" || value.length === 0 || value.length > 512 || !/^turns?:/i.test(value)) {
      throw new Error("Invalid TURN URL");
    }
    return value;
  });
  const username = requiredText(record, "username", 256);
  const credential = requiredText(record, "credential", 512);
  const expiresAt = record.expiresAt;
  if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("Invalid TURN credential expiry");
  }
  return { urls, username, credential, expiresAt };
};

export const parseSignalingEvent = (raw: string): SignalingEvent => {
  const record = asRecord(JSON.parse(raw) as unknown);
  const type = requiredText(record, "type", 64);

  switch (type) {
    case "session-created":
    case "session-joined": {
      const sessionId = requiredText(record, "sessionId", 12);
      if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error("Invalid signaling session id");
      const expiresAt = record.expiresAt;
      if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
        throw new Error("Invalid signaling expiry");
      }
      return { type, sessionId, expiresAt };
    }
    case "turn-credentials":
      return { type: "turn-credentials", ...parseTurnCredentials(record) };
    case "peer-joined":
      return { type: "peer-joined" };
    case "peer-left":
      return { type: "peer-left" };
    case "signal":
      return { type: "signal", payload: parseSignalPayload(record.payload) };
    case "session-closed":
      return { type: "session-closed", reason: requiredText(record, "reason") };
    case "error":
      return { type: "error", code: requiredText(record, "code", 128) };
    default:
      throw new Error("Unknown signaling event type");
  }
};

export class SignalingClient {
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private connectPromise: Promise<void> | null = null;
  private intentionalDisconnect = false;
  private retryWake: (() => void) | null = null;

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;

    this.intentionalDisconnect = false;
    this.connectPromise = this.connectWithRetry().finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  /**
   * The signaling service may need a moment to answer (cold edge, brief
   * network loss). Retry with exponential backoff instead of failing the
   * session on the first attempt, and emit connect-retry so the UI can
   * show a "waking" state rather than an error.
   */
  private async connectWithRetry(): Promise<void> {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        await this.connectOnce();
        return;
      } catch (error) {
        if (this.intentionalDisconnect) throw error;
        if (attempt >= CONNECT_MAX_ATTEMPTS) throw error;
        this.emit({ type: "connect-retry", attempt });
        const delay = Math.min(CONNECT_RETRY_BASE_MS * 2 ** (attempt - 1), CONNECT_RETRY_MAX_MS);
        await this.delayInterruptible(delay);
        if (this.intentionalDisconnect) throw new Error("Signaling connection cancelled");
      }
    }
  }

  private delayInterruptible(ms: number): Promise<void> {
    return new Promise<void>(resolve => {
      const timer = window.setTimeout(() => {
        this.retryWake = null;
        resolve();
      }, ms);
      this.retryWake = () => {
        window.clearTimeout(timer);
        this.retryWake = null;
        resolve();
      };
    });
  }

  private connectOnce(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      let opened = false;
      let settled = false;

      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanupOpeningListeners();
        try { socket.close(1000, "connect-timeout"); } catch { /* ignore */ }
        reject(new Error("Timed out connecting to Bridge signaling service"));
      }, CONNECT_TIMEOUT_MS);

      const cleanupOpeningListeners = () => {
        window.clearTimeout(timeout);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onOpeningError);
      };
      const onOpen = () => {
        if (settled) return;
        opened = true;
        settled = true;
        cleanupOpeningListeners();
        resolve();
      };
      const onOpeningError = () => {
        if (settled) return;
        settled = true;
        cleanupOpeningListeners();
        reject(new Error("Unable to connect to Bridge signaling service"));
      };

      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onOpeningError);
      socket.addEventListener("message", event => {
        try {
          this.emit(parseSignalingEvent(String(event.data)));
        } catch {
          this.emit({ type: "error", code: "invalid-server-message" });
        }
      });
      socket.addEventListener("close", event => {
        cleanupOpeningListeners();
        if (this.socket === socket) this.socket = null;
        if (!opened) {
          if (!settled) {
            settled = true;
            reject(new Error("Bridge signaling connection closed before it was ready"));
          }
          return;
        }
        if (!this.intentionalDisconnect) {
          this.emit({ type: "socket-closed", code: event.code, reason: event.reason || "Signaling connection closed" });
        }
      });
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  createSession(verifier: string): void {
    this.send({ type: "create-session", verifier });
  }

  joinSession(sessionId: string, verifier: string): void {
    this.send({ type: "join-session", sessionId, verifier });
  }

  sendSignal(payload: SignalPayload): void {
    this.send({ type: "signal", payload });
  }

  reportConnectionRoute(route: ObservedConnectionRoute): void {
    this.send({ type: "route-report", route });
  }

  closeSession(): void {
    this.send({ type: "close-session" });
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.retryWake?.();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "client-disconnect");
  }

  private emit(event: SignalingEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private send(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Signaling socket is not connected");
    }
    this.socket.send(JSON.stringify(payload));
  }
}

export const defaultSignalingUrl = (): string =>
  signalingUrlForEnvironment(import.meta.env.VITE_SIGNALING_URL as string | undefined, window.location);