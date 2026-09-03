import { configuredIceServers, hasTurnServer } from "./ice-config";
import { isRelayOnlyPreferred } from "./privacy-preference";
import type { SignalPayload } from "./signaling";

export type ConnectionRoute = "connecting" | "direct" | "relayed" | "disconnected";

export type PeerEvents = {
  onSignal: (payload: SignalPayload) => void;
  onChannel: (channel: RTCDataChannel) => void;
  onRouteChange?: (route: ConnectionRoute) => void;
  onStateChange?: (state: RTCPeerConnectionState) => void;
};

export type PeerOptions = {
  initiator: boolean;
  iceServers?: RTCIceServer[];
  relayOnly?: boolean;
};

export class PeerTransport {
  readonly connection: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private readonly pendingRemoteCandidates: RTCIceCandidateInit[] = [];

  constructor(
    private readonly options: PeerOptions,
    private readonly events: PeerEvents
  ) {
    const relayOnly = options.relayOnly ?? isRelayOnlyPreferred();
    const iceServers = options.iceServers ?? configuredIceServers();
    if (relayOnly && !hasTurnServer(iceServers)) {
      throw new Error("Relay-only privacy mode requires a configured TURN server");
    }

    this.connection = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: relayOnly ? "relay" : "all"
    });

    this.connection.addEventListener("icecandidate", event => {
      if (event.candidate) {
        this.events.onSignal({ candidate: event.candidate.toJSON() });
      }
    });

    this.connection.addEventListener("connectionstatechange", () => {
      this.events.onStateChange?.(this.connection.connectionState);
      if (this.connection.connectionState === "connected") {
        void this.refreshRoute().catch(() => this.events.onRouteChange?.("connecting"));
      } else if (["failed", "closed", "disconnected"].includes(this.connection.connectionState)) {
        this.events.onRouteChange?.("disconnected");
      }
    });

    this.connection.addEventListener("datachannel", event => {
      this.attachChannel(event.channel);
    });

    if (options.initiator) {
      this.createInitiatorChannel();
    }
  }

  get dataChannel(): RTCDataChannel | null {
    return this.channel;
  }

  async start(): Promise<void> {
    if (!this.options.initiator) return;
    const offer = await this.connection.createOffer();
    await this.connection.setLocalDescription(offer);
    this.events.onSignal({ description: offer });
  }

  async acceptSignal(payload: SignalPayload): Promise<void> {
    if (this.connection.signalingState === "closed") return;

    if ("description" in payload) {
      const description = payload.description;
      await this.connection.setRemoteDescription(description);
      await this.flushRemoteCandidates();

      if (description.type === "offer") {
        const answer = await this.connection.createAnswer();
        await this.connection.setLocalDescription(answer);
        this.events.onSignal({ description: answer });
      }
      return;
    }

    if ("candidate" in payload) {
      if (!this.connection.remoteDescription) {
        this.pendingRemoteCandidates.push(payload.candidate);
        return;
      }
      await this.connection.addIceCandidate(payload.candidate);
    }
  }

  async restartIce(): Promise<void> {
    if (!this.options.initiator || this.connection.signalingState === "closed") return;

    if (!this.channel || this.channel.readyState === "closed" || this.channel.readyState === "closing") {
      this.createInitiatorChannel();
    }

    this.connection.restartIce();
    const offer = await this.connection.createOffer({ iceRestart: true });
    await this.connection.setLocalDescription(offer);
    this.events.onSignal({ description: offer });
  }

  close(): void {
    this.pendingRemoteCandidates.length = 0;
    try { this.channel?.close(); } catch { /* ignore teardown races */ }
    this.connection.close();
    this.events.onRouteChange?.("disconnected");
  }

  async refreshRoute(): Promise<ConnectionRoute> {
    const stats = await this.connection.getStats();
    let selectedPair: RTCIceCandidatePairStats | undefined;

    stats.forEach(report => {
      if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
        selectedPair = report as RTCIceCandidatePairStats;
      }
    });

    if (!selectedPair) {
      this.events.onRouteChange?.("connecting");
      return "connecting";
    }

    const local = stats.get(selectedPair.localCandidateId) as RTCIceCandidateStats | undefined;
    const remote = stats.get(selectedPair.remoteCandidateId) as RTCIceCandidateStats | undefined;
    const route: ConnectionRoute =
      local?.candidateType === "relay" || remote?.candidateType === "relay"
        ? "relayed"
        : "direct";

    this.events.onRouteChange?.(route);
    return route;
  }

  private async flushRemoteCandidates(): Promise<void> {
    while (this.pendingRemoteCandidates.length > 0 && this.connection.remoteDescription) {
      const candidate = this.pendingRemoteCandidates.shift();
      if (candidate) await this.connection.addIceCandidate(candidate);
    }
  }

  private createInitiatorChannel(): void {
    this.attachChannel(this.connection.createDataChannel("bridge", { ordered: true }));
  }

  private attachChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    this.events.onChannel(channel);
  }
}
