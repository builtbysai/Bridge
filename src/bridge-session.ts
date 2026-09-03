import { configuredIceServers } from "./ice-config";
import { PeerTransport, type ConnectionRoute } from "./peer";
import {
  createKeyConfirmationProof,
  derivePairingVerifier,
  verifyKeyConfirmationProof,
  type ConfirmationRole
} from "./pairing-auth";
import { RecoveryController } from "./recovery";
import { SignalingClient, defaultSignalingUrl, type SignalingEvent } from "./signaling";

export type BridgeRole = "host" | "guest";

export type BridgeSessionState =
  | "idle"
  | "signaling"
  | "waiting"
  | "connecting"
  | "connected"
  | "closed"
  | "error";

export type BridgeSessionEvents = {
  onState?: (state: BridgeSessionState, detail?: string) => void;
  onRoute?: (route: ConnectionRoute) => void;
  onChannel?: (channel: RTCDataChannel) => void;
  onSession?: (sessionId: string, expiresAt: number) => void;
};

type ConfirmationMessage = {
  type: "bridge-key-confirm";
  version: 1;
  role: ConfirmationRole;
  proof: string;
};

const AUTH_TIMEOUT_MS = 8_000;

export class BridgeSession {
  private readonly signaling: SignalingClient;
  private peer: PeerTransport | null = null;
  private unsubscribe: (() => void) | null = null;
  private role: BridgeRole | null = null;
  private pairingSecret: string | null = null;
  private sessionId: string | null = null;
  private authenticationFailed = false;
  private signalingIceServers: RTCIceServer[] | null = null;
  private readonly recovery: RecoveryController;
  private eventQueue: Promise<void> = Promise.resolve();
  private state: BridgeSessionState = "idle";
  private closing = false;

  constructor(
    signalingUrl = defaultSignalingUrl(),
    private readonly events: BridgeSessionEvents = {},
    private readonly iceServers?: RTCIceServer[]
  ) {
    this.signaling = new SignalingClient(signalingUrl);
    this.recovery = new RecoveryController(
      {
        onAttempt: async attempt => {
          this.emitState("connecting", `Connection recovery attempt ${attempt}`);
          if (!this.peer) throw new Error("Peer transport unavailable");

          if (this.role === "host") {
            await this.peer.restartIce();
            return;
          }

          if (this.peer.connection.connectionState === "connected") {
            this.recovery.recovered();
          }
        },
        onState: state => {
          if (state === "exhausted") {
            this.failSession("Unable to recover the WebRTC connection");
          }
        }
      },
      { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 8_000 }
    );
  }

  async host(secret: string): Promise<void> {
    this.closing = false;
    this.role = "host";
    this.pairingSecret = secret;
    this.authenticationFailed = false;
    this.signalingIceServers = null;
    this.bindSignaling();
    this.emitState("signaling");
    const verifier = await derivePairingVerifier(secret);
    await this.signaling.connect();
    this.signaling.createSession(verifier);
  }

  async join(sessionId: string, secret: string): Promise<void> {
    this.closing = false;
    this.role = "guest";
    this.sessionId = sessionId;
    this.pairingSecret = secret;
    this.authenticationFailed = false;
    this.signalingIceServers = null;
    this.bindSignaling();
    this.emitState("signaling");
    const verifier = await derivePairingVerifier(secret);
    await this.signaling.connect();
    this.signaling.joinSession(sessionId, verifier);
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    this.recovery.stop();
    if (this.role === "host") {
      try {
        this.signaling.closeSession();
      } catch {
        // The socket may already be gone during page teardown.
      }
    }
    this.cleanupPeer();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.signaling.disconnect();
    this.emitState("closed");
  }

  private emitState(state: BridgeSessionState, detail?: string): void {
    this.state = state;
    this.events.onState?.(state, detail);
  }

  private bindSignaling(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.signaling.subscribe(event => {
      this.eventQueue = this.eventQueue
        .then(() => this.handleEvent(event))
        .catch(error => {
          this.failSession(error instanceof Error ? error.message : "Bridge signaling failed");
        });
    });
  }

  private async handleEvent(event: SignalingEvent): Promise<void> {
    if (this.closing) return;

    switch (event.type) {
      case "session-created":
        this.sessionId = event.sessionId;
        this.events.onSession?.(event.sessionId, event.expiresAt);
        this.emitState("waiting");
        return;
      case "turn-credentials":
        if (!this.iceServers) this.signalingIceServers = configuredIceServers(event);
        return;
      case "session-joined":
        this.sessionId = event.sessionId;
        this.events.onSession?.(event.sessionId, event.expiresAt);
        this.emitState("connecting");
        this.ensurePeer(false);
        return;
      case "peer-joined":
        this.emitState("connecting");
        this.ensurePeer(true);
        await this.peer?.start();
        return;
      case "signal":
        this.ensurePeer(this.role === "host");
        await this.peer?.acceptSignal(event.payload);
        return;
      case "peer-left":
        this.recovery.stop();
        this.cleanupPeer();
        this.emitState(this.role === "host" ? "waiting" : "closed", "Peer disconnected");
        return;
      case "session-closed":
        this.recovery.stop();
        this.cleanupPeer();
        this.signaling.disconnect();
        this.emitState("closed", event.reason);
        return;
      case "socket-closed":
        this.recovery.stop();
        this.cleanupPeer();
        if (this.state !== "closed") {
          this.emitState("error", event.reason || `Signaling connection closed (${event.code})`);
        }
        return;
      case "error":
        this.failSession(`Signaling error: ${event.code}`);
        return;
    }
  }

  private ensurePeer(initiator: boolean): void {
    if (this.peer) return;

    this.peer = new PeerTransport(
      { initiator, iceServers: this.iceServers ?? this.signalingIceServers ?? undefined },
      {
        onSignal: payload => {
          try {
            this.signaling.sendSignal(payload);
          } catch (error) {
            this.failSession(error instanceof Error ? error.message : "Unable to send WebRTC signaling data");
          }
        },
        onChannel: channel => {
          void this.authenticateChannel(channel);
          channel.addEventListener("close", () => {
            if (!this.authenticationFailed && this.peer?.connection.connectionState !== "closed" && !this.closing) {
              this.emitState("connecting", "Data channel closed; attempting recovery");
              this.recovery.schedule(true);
            }
          });
        },
        onRouteChange: route => {
          this.events.onRoute?.(route);
          if (route === "direct" || route === "relayed") {
            try {
              this.signaling.reportConnectionRoute(route);
            } catch {
              // Observability must never affect the peer connection lifecycle.
            }
          }
        },
        onStateChange: state => {
          if (this.authenticationFailed || this.closing) return;
          if (state === "connected") return;
          if (state === "disconnected") {
            this.emitState("connecting", "Connection interrupted; attempting recovery");
            this.recovery.schedule();
            return;
          }
          if (state === "failed") {
            this.emitState("connecting", "Connection failed; attempting ICE restart");
            this.recovery.schedule(true);
          }
        }
      }
    );
  }

  private async authenticateChannel(channel: RTCDataChannel): Promise<void> {
    const role = this.role;
    const sessionId = this.sessionId;
    const secret = this.pairingSecret;
    if (!role || !sessionId || !secret) {
      this.failAuthentication(channel, "Pairing state unavailable");
      return;
    }

    const expectedRole: ConfirmationRole = role === "host" ? "guest" : "host";
    const proof = await createKeyConfirmationProof(secret, sessionId, role);

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Pairing confirmation timed out")), AUTH_TIMEOUT_MS);
        let sent = false;
        let settled = false;

        const cleanup = () => {
          window.clearTimeout(timeout);
          channel.removeEventListener("open", sendProof);
          channel.removeEventListener("message", onMessage);
          channel.removeEventListener("close", onClose);
        };

        const succeed = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        };

        const fail = (message: string) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error(message));
        };

        const sendProof = () => {
          if (sent || channel.readyState !== "open") return;
          sent = true;
          const message: ConfirmationMessage = {
            type: "bridge-key-confirm",
            version: 1,
            role,
            proof
          };
          channel.send(JSON.stringify(message));
        };

        const onClose = () => fail("Data channel closed during pairing confirmation");

        const onMessage = (event: MessageEvent) => {
          if (typeof event.data !== "string") return;
          let message: Partial<ConfirmationMessage>;
          try {
            const parsed: unknown = JSON.parse(event.data);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
            message = parsed as Partial<ConfirmationMessage>;
          } catch {
            return;
          }
          if (message.type !== "bridge-key-confirm") return;
          if (message.version !== 1 || message.role !== expectedRole || typeof message.proof !== "string" || message.proof.length > 128) {
            fail("Peer pairing confirmation was invalid");
            return;
          }
          void verifyKeyConfirmationProof(secret, sessionId, expectedRole, message.proof)
            .then(valid => valid ? succeed() : fail("Peer pairing key did not match"))
            .catch(() => fail("Peer pairing confirmation failed"));
        };

        channel.addEventListener("message", onMessage);
        channel.addEventListener("close", onClose);
        if (channel.readyState === "open") sendProof();
        else channel.addEventListener("open", sendProof);
      });

      if (this.closing || this.peer?.connection.connectionState === "closed") {
        try { channel.close(); } catch { /* ignore */ }
        return;
      }
      this.authenticationFailed = false;
      this.recovery.recovered();
      this.emitState("connected", "Peer pairing key confirmed");
      this.events.onChannel?.(channel);
    } catch (error) {
      this.failAuthentication(channel, error instanceof Error ? error.message : "Peer pairing confirmation failed");
    }
  }

  private cleanupPeer(): void {
    this.peer?.close();
    this.peer = null;
  }

  private failSession(detail: string): void {
    if (this.closing || this.state === "closed") return;
    this.recovery.stop();
    this.cleanupPeer();
    this.signaling.disconnect();
    this.emitState("error", detail);
  }

  private failAuthentication(channel: RTCDataChannel, detail: string): void {
    this.authenticationFailed = true;
    this.recovery.stop();
    try {
      channel.close();
    } catch {
      // Ignore close races while rejecting an unauthenticated peer.
    }
    this.cleanupPeer();
    this.signaling.disconnect();
    this.emitState("error", detail);
  }
}