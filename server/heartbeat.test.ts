import { describe, expect, it } from "vitest";
import { HeartbeatMonitor, type HeartbeatSocket } from "./heartbeat.js";

class FakeSocket implements HeartbeatSocket {
  readonly OPEN = 1;
  readyState = this.OPEN;
  pings = 0;
  terminated = false;
  failPing = false;
  failTerminate = false;

  ping(): void {
    this.pings += 1;
    if (this.failPing) throw new Error("ping failed");
  }

  terminate(): void {
    if (this.failTerminate) throw new Error("terminate failed");
    this.terminated = true;
    this.readyState = 3;
  }
}

describe("HeartbeatMonitor", () => {
  it("pings tracked open sockets and accepts pong acknowledgement", () => {
    const monitor = new HeartbeatMonitor<FakeSocket>();
    const socket = new FakeSocket();
    monitor.track(socket);

    expect(monitor.sweep([socket])).toBe(0);
    expect(socket.pings).toBe(1);

    monitor.acknowledge(socket);
    expect(monitor.sweep([socket])).toBe(0);
    expect(socket.pings).toBe(2);
    expect(socket.terminated).toBe(false);
  });

  it("terminates an open socket that misses a heartbeat acknowledgement", () => {
    const monitor = new HeartbeatMonitor<FakeSocket>();
    const socket = new FakeSocket();
    monitor.track(socket);

    monitor.sweep([socket]);
    expect(monitor.sweep([socket])).toBe(1);
    expect(socket.terminated).toBe(true);
  });

  it("fails closed when ping throws without letting the sweep throw", () => {
    const monitor = new HeartbeatMonitor<FakeSocket>();
    const socket = new FakeSocket();
    socket.failPing = true;
    monitor.track(socket);

    expect(() => monitor.sweep([socket])).not.toThrow();
    expect(socket.pings).toBe(1);
    expect(socket.terminated).toBe(true);
  });

  it("contains a termination race so one broken socket cannot crash a sweep", () => {
    const monitor = new HeartbeatMonitor<FakeSocket>();
    const broken = new FakeSocket();
    const healthy = new FakeSocket();
    broken.failTerminate = true;
    monitor.track(broken);
    monitor.track(healthy);

    monitor.sweep([broken]);
    expect(() => monitor.sweep([broken, healthy])).not.toThrow();
    expect(healthy.pings).toBe(1);
  });

  it("ignores non-open and forgotten sockets", () => {
    const monitor = new HeartbeatMonitor<FakeSocket>();
    const closed = new FakeSocket();
    closed.readyState = 3;
    const forgotten = new FakeSocket();
    monitor.track(closed);
    monitor.track(forgotten);
    monitor.forget(forgotten);

    expect(monitor.sweep([closed])).toBe(0);
    expect(closed.pings).toBe(0);
    expect(monitor.sweep([forgotten])).toBe(0);
    expect(forgotten.pings).toBe(1);
  });
});
