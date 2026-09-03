import { describe, expect, it } from "vitest";
import { SignalingMetrics } from "./metrics";

describe("SignalingMetrics", () => {
  it("tracks aggregate signaling errors without exposing peer keys", () => {
    const metrics = new SignalingMetrics();
    metrics.recordError("unauthorized");
    metrics.recordError("unauthorized");
    metrics.recordError("peer-not-ready");
    metrics.reportRoute("private-connection-id", "direct");

    const snapshot = metrics.snapshot(2, 3);
    expect(snapshot.signalingErrors).toEqual({
      "peer-not-ready": 1,
      unauthorized: 2
    });
    expect(JSON.stringify(snapshot)).not.toContain("private-connection-id");
  });

  it("reports the current direct/relay ratio and removes disconnected peers", () => {
    const metrics = new SignalingMetrics();
    metrics.reportRoute("a", "direct");
    metrics.reportRoute("b", "relayed");
    metrics.reportRoute("c", "relayed");

    expect(metrics.snapshot(1, 3).routes).toEqual({
      direct: 1,
      relayed: 2,
      observedPeers: 3,
      relayRatio: 2 / 3
    });

    metrics.reportRoute("b", "direct");
    metrics.removePeer("c");
    expect(metrics.snapshot(1, 2).routes).toEqual({
      direct: 2,
      relayed: 0,
      observedPeers: 2,
      relayRatio: 0
    });
  });

  it("tracks session lifecycle counters separately from current gauges", () => {
    const metrics = new SignalingMetrics();
    metrics.recordSessionCreated();
    metrics.recordSessionCreated();
    metrics.recordSessionJoined();

    const snapshot = metrics.snapshot(1, 2);
    expect(snapshot.sessions).toBe(1);
    expect(snapshot.connections).toBe(2);
    expect(snapshot.sessionsCreated).toBe(2);
    expect(snapshot.sessionsJoined).toBe(1);
    expect(snapshot.routes.relayRatio).toBeNull();
  });
});
