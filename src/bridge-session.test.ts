import { describe, expect, it, vi } from "vitest";
import { BridgeSession, type BridgeSessionState } from "./bridge-session";

// BridgeSession's constructor never touches the DOM/WebRTC globals this test
// environment doesn't provide (WebSocket, RTCPeerConnection): SignalingClient
// and RecoveryController only construct plain objects, and PeerTransport is
// only ever instantiated later, inside event handling. Passing an explicit
// signalingUrl also avoids the default `defaultSignalingUrl()` touching
// `window.location`. That lets these tests exercise BridgeSession's private
// signaling-loss decision directly: they stand in for a real, already
// negotiated RTCPeerConnection with a minimal fake carrying just the
// `connection.connectionState` and `close()` surface that decision reads,
// and reach the private `handleEvent` the same way the real signaling
// subscription does, bypassing only its `eventQueue` serialization wrapper
// (irrelevant to the decision under test).
const SIGNALING_URL = "wss://bridge.test/signal";

type FakePeer = {
  connection: { connectionState: RTCPeerConnectionState };
  close: ReturnType<typeof vi.fn>;
};

const makeFakePeer = (connectionState: RTCPeerConnectionState): FakePeer => ({
  connection: { connectionState },
  close: vi.fn(),
});

// Reaches BridgeSession's private state to set up a scenario or read the
// outcome. BridgeSession has no existing test suite/pattern to follow here
// (its constructor requires exactly this kind of browser-API isolation),
// so this is the most direct way to regression-test the signaling-loss
// decision without adding new test infrastructure (e.g. a DOM/WebRTC shim)
// for a single, narrowly scoped fix.
type Internals = {
  peer: FakePeer | null;
  role: "host" | "guest" | null;
  state: BridgeSessionState;
  closing: boolean;
  signaling: { disconnect: () => void };
  recovery: { stop: () => void };
  handleEvent: (event: { type: string; reason?: string; code?: number }) => Promise<void>;
};

const asInternals = (session: BridgeSession): Internals => session as unknown as Internals;

describe("BridgeSession signaling-loss handling", () => {
  it.each([
    ["peer-left", { type: "peer-left" }],
    ["session-closed", { type: "session-closed", reason: "expired" }],
    ["socket-closed", { type: "socket-closed", code: 1006, reason: "" }],
  ] as const)(
    "keeps a healthy connected peer alive when %s fires instead of tearing it down",
    async (_label, event) => {
      const onState = vi.fn();
      const session = new BridgeSession(SIGNALING_URL, { onState });
      const internals = asInternals(session);
      const fakePeer = makeFakePeer("connected");
      internals.peer = fakePeer;
      internals.role = "host";
      internals.state = "connected";
      const disconnectSpy = vi.spyOn(internals.signaling, "disconnect");
      const stopSpy = vi.spyOn(internals.recovery, "stop");

      await internals.handleEvent(event);

      // The peer connection is untouched: no close() call, and the field
      // itself is still the same live peer, not nulled out.
      expect(fakePeer.close).not.toHaveBeenCalled();
      expect(internals.peer).toBe(fakePeer);
      // The session's externally visible state must stay "connected" too --
      // otherwise the UI would gate the still-live transfer as if it had
      // stopped, which would defeat the point of preserving the peer.
      expect(internals.state).toBe("connected");
      expect(onState).not.toHaveBeenCalled();
      expect(stopSpy).not.toHaveBeenCalled();

      if (event.type === "session-closed") {
        // The signaling channel really is gone once the server closes the
        // session, regardless of what happens to the peer connection.
        expect(disconnectSpy).toHaveBeenCalledTimes(1);
      } else {
        expect(disconnectSpy).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    ["peer-left", { type: "peer-left" }, "waiting"],
    ["session-closed", { type: "session-closed", reason: "expired" }, "closed"],
    ["socket-closed", { type: "socket-closed", code: 1006, reason: "network blip" }, "error"],
  ] as const)(
    "still tears down immediately on %s when the peer connection is not healthy",
    async (_label, event, expectedState) => {
      const onState = vi.fn();
      const session = new BridgeSession(SIGNALING_URL, { onState });
      const internals = asInternals(session);
      const fakePeer = makeFakePeer("connecting");
      internals.peer = fakePeer;
      internals.role = "host";
      internals.state = "connecting";

      await internals.handleEvent(event);

      expect(fakePeer.close).toHaveBeenCalledTimes(1);
      expect(internals.peer).toBeNull();
      expect(internals.state).toBe(expectedState);
      expect(onState).toHaveBeenCalledTimes(1);
    },
  );

  it("has no peer to preserve before one is ever established, and still cleans up immediately", async () => {
    const onState = vi.fn();
    const session = new BridgeSession(SIGNALING_URL, { onState });
    const internals = asInternals(session);
    internals.role = "guest";
    internals.state = "waiting";

    await internals.handleEvent({ type: "peer-left" });

    expect(internals.peer).toBeNull();
    expect(internals.state).toBe("closed");
    expect(onState).toHaveBeenCalledTimes(1);
  });

  it("tears down a peer that has already failed, not just one that never connected", async () => {
    const session = new BridgeSession(SIGNALING_URL, {});
    const internals = asInternals(session);
    const fakePeer = makeFakePeer("failed");
    internals.peer = fakePeer;
    internals.role = "host";
    internals.state = "connecting";

    await internals.handleEvent({ type: "socket-closed", code: 1006, reason: "" });

    expect(fakePeer.close).toHaveBeenCalledTimes(1);
    expect(internals.peer).toBeNull();
    expect(internals.state).toBe("error");
  });
});
