import { describe, expect, it } from "vitest";
import { closeQuietly, sendJsonQuietly, terminateQuietly, type CloseSocket, type SendSocket, type TerminateSocket } from "./socket-safety.js";

class FakeSocket implements SendSocket, CloseSocket, TerminateSocket {
  readonly OPEN = 1;
  readyState = this.OPEN;
  sent: string[] = [];
  closed: Array<{ code?: number; reason?: string }> = [];
  terminated = 0;
  failSend = false;
  failClose = false;
  failTerminate = false;

  send(data: string): void {
    if (this.failSend) throw new Error("send failed");
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    if (this.failClose) throw new Error("close failed");
    this.closed.push({ code, reason });
  }

  terminate(): void {
    if (this.failTerminate) throw new Error("terminate failed");
    this.terminated += 1;
  }
}

describe("socket safety helpers", () => {
  it("serializes and sends JSON on an open socket", () => {
    const socket = new FakeSocket();

    expect(sendJsonQuietly(socket, { type: "ok" })).toBe(true);
    expect(socket.sent).toEqual(['{"type":"ok"}']);
  });

  it("does not send when the socket is no longer open", () => {
    const socket = new FakeSocket();
    socket.readyState = 3;

    expect(sendJsonQuietly(socket, { type: "ignored" })).toBe(false);
    expect(socket.sent).toEqual([]);
  });

  it("contains synchronous send races", () => {
    const socket = new FakeSocket();
    socket.failSend = true;

    expect(() => sendJsonQuietly(socket, { type: "race" })).not.toThrow();
    expect(sendJsonQuietly(socket, { type: "race" })).toBe(false);
  });

  it("contains close and terminate teardown races", () => {
    const socket = new FakeSocket();
    socket.failClose = true;
    socket.failTerminate = true;

    expect(() => closeQuietly(socket, 1001, "shutdown")).not.toThrow();
    expect(() => terminateQuietly(socket)).not.toThrow();
  });
});
