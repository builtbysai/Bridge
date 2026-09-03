export type ObservedRoute = "direct" | "relayed";

export type SignalingMetricsSnapshot = {
  uptimeSeconds: number;
  connections: number;
  sessions: number;
  activeConnections: number;
  activeSessions: number;
  sessionsCreated: number;
  sessionsJoined: number;
  signalingErrors: Record<string, number>;
  routes: {
    direct: number;
    relayed: number;
    observedPeers: number;
    relayRatio: number | null;
  };
};

export class SignalingMetrics {
  private readonly startedAt = Date.now();
  private readonly errors = new Map<string, number>();
  private readonly routes = new Map<string, ObservedRoute>();
  private created = 0;
  private joined = 0;

  recordSessionCreated(): void {
    this.created += 1;
  }

  recordSessionJoined(): void {
    this.joined += 1;
  }

  recordError(code: string): void {
    this.errors.set(code, (this.errors.get(code) ?? 0) + 1);
  }

  reportRoute(peerKey: string, route: ObservedRoute): void {
    this.routes.set(peerKey, route);
  }

  removePeer(peerKey: string): void {
    this.routes.delete(peerKey);
  }

  snapshot(sessions: number, connections: number, now = Date.now()): SignalingMetricsSnapshot {
    let direct = 0;
    let relayed = 0;
    for (const route of this.routes.values()) {
      if (route === "direct") direct += 1;
      else relayed += 1;
    }
    const observedPeers = direct + relayed;

    return {
      uptimeSeconds: Math.max(0, Math.floor((now - this.startedAt) / 1000)),
      connections,
      sessions,
      activeConnections: connections,
      activeSessions: sessions,
      sessionsCreated: this.created,
      sessionsJoined: this.joined,
      signalingErrors: Object.fromEntries([...this.errors.entries()].sort(([a], [b]) => a.localeCompare(b))),
      routes: {
        direct,
        relayed,
        observedPeers,
        relayRatio: observedPeers === 0 ? null : relayed / observedPeers
      }
    };
  }
}
