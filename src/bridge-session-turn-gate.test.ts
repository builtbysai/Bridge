import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeSession } from "./bridge-session";
import type { SignalingEvent } from "./signaling";

// Regression tests for the TURN credential race: the worker used to send
// session-joined BEFORE turn-credentials, so the guest built its
// RTCPeerConnection STUN-only and the relay config arrived too late.
// BridgeSession must now defer peer construction until the TURN status is
// resolved (credentials received, or known absent after the timeout).
//
// PeerTransport is mocked because this environment has no RTCPeerConnection;
// the mock records the iceServers each constructed peer received so the
// tests can assert the relay config was (or was not) present.
const constructedPeers: Array<{ options: { initiator: boolean; iceServers?: RTCIceServer[] } }> = [];

vi.mock("./peer", () => {
  class FakePeerTransport {
    connection = { connectionState: "new" as RTCPeerConnectionState };
    constructor(
      public readonly options: { initiator: boolean; iceServers?: RTCIceServer[] },
      public readonly events: unknown
    ) {
      constructedPeers.push({ options });
    }
    start = vi.fn(async () => {});
    acceptSignal = vi.fn(async () => {});
    restartIce = vi.fn(async () => {});
    close = vi.fn();
  }
  return { PeerTransport: FakePeerTransport };
});

const SIGNALING_URL = "wss://bridge.test/signal";
const SESSION_ID = "a1b2c3d4e5f6";

const turnEvent = (): Extract<SignalingEvent, { type: "turn-credentials" }> => ({
  type: "turn-credentials",
  urls: ["turn:relay.example:3478"],
  username: "turn-user",
  credential: "turn-pass",
  expiresAt: Date.now() + 3_600_000,
});

const joinedEvent = (): Extract<SignalingEvent, { type: "session-joined" }> => ({
  type: "session-joined",
  sessionId: SESSION_ID,
  expiresAt: Date.now() + 600_000,
});

type Internals = {
  peer: unknown;
  handleEvent: (event: SignalingEvent) => Promise<void>;
};

const asInternals = (session: BridgeSession): Internals => session as unknown as Internals;

const tick = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe("BridgeSession TURN gate", () => {
  beforeEach(() => {
    constructedPeers.length = 0;
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defers guest peer creation until TURN credentials arrive (old worker order)", async () => {
    const session = new BridgeSession(SIGNALING_URL, {});
    const internals = asInternals(session);

    // Old worker order: session-joined first, turn-credentials after.
    const joined = internals.handleEvent(joinedEvent());
    await tick();
    // The peer must NOT be constructed yet: TURN status is unresolved.
    expect(constructedPeers.length).toBe(0);

    await internals.handleEvent(turnEvent());
    await joined;

    expect(constructedPeers.length).toBe(1);
    const iceServers = constructedPeers[0].options.iceServers ?? [];
    const flat = JSON.stringify(iceServers);
    expect(flat).toContain("turn:relay.example:3478");
    expect(flat).toContain("turn-user");
  });

  it("builds the peer immediately when TURN credentials arrive first (new worker order)", async () => {
    const session = new BridgeSession(SIGNALING_URL, {});
    const internals = asInternals(session);

    await internals.handleEvent(turnEvent());
    await internals.handleEvent(joinedEvent());

    expect(constructedPeers.length).toBe(1);
    expect(JSON.stringify(constructedPeers[0].options.iceServers)).toContain("turn:relay.example:3478");
  });

  it("falls back to STUN-only after the timeout when the worker never sends TURN", async () => {
    vi.useFakeTimers();
    const session = new BridgeSession(SIGNALING_URL, {});
    const internals = asInternals(session);

    const joined = internals.handleEvent(joinedEvent());
    // No turn-credentials ever arrive; the gate must time out, not hang.
    await vi.advanceTimersByTimeAsync(9_000);
    await joined;

    expect(constructedPeers.length).toBe(1);
    // No signaling iceServers: PeerTransport falls back to its own defaults.
    expect(constructedPeers[0].options.iceServers).toBeUndefined();
  });

  it("does not deadlock when a signal arrives while waiting for TURN", async () => {
    const session = new BridgeSession(SIGNALING_URL, {});
    const internals = asInternals(session);

    const joined = internals.handleEvent(joinedEvent());
    await tick();
    expect(constructedPeers.length).toBe(0);

    // turn-credentials resolves the gate; the queued session-joined handler
    // then completes. If the gate resolved inside the serialized queue this
    // would hang forever.
    await internals.handleEvent(turnEvent());
    await joined;
    expect(constructedPeers.length).toBe(1);
  });
});
