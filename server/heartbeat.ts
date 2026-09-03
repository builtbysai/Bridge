import { terminateQuietly } from "./socket-safety.js";

export type HeartbeatSocket = {
  readonly readyState: number;
  readonly OPEN: number;
  ping(): void;
  terminate(): void;
};

export class HeartbeatMonitor<T extends HeartbeatSocket = HeartbeatSocket> {
  private readonly alive = new WeakMap<T, boolean>();

  track(socket: T): void {
    this.alive.set(socket, true);
  }

  acknowledge(socket: T): void {
    if (this.alive.has(socket)) this.alive.set(socket, true);
  }

  forget(socket: T): void {
    this.alive.delete(socket);
  }

  sweep(sockets: Iterable<T>): number {
    let terminated = 0;

    for (const socket of sockets) {
      if (socket.readyState !== socket.OPEN) continue;

      if (this.alive.get(socket) === false) {
        this.alive.delete(socket);
        terminateQuietly(socket);
        terminated += 1;
        continue;
      }

      this.alive.set(socket, false);
      try {
        socket.ping();
      } catch {
        // Treat a synchronous ping failure as a dead transport. Without this
        // guard an operational socket race could escape the interval callback
        // and terminate the entire signaling process.
        this.alive.delete(socket);
        terminateQuietly(socket);
        terminated += 1;
      }
    }

    return terminated;
  }
}
