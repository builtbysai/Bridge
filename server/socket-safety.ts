export type SendSocket = {
  readonly readyState: number;
  readonly OPEN: number;
  send(data: string): void;
};

export type CloseSocket = {
  close(code?: number, reason?: string): void;
};

export type TerminateSocket = {
  terminate(): void;
};

export const sendJsonQuietly = (socket: SendSocket, payload: unknown): boolean => {
  if (socket.readyState !== socket.OPEN) return false;

  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    // A WebSocket can transition away from OPEN between the readyState check
    // and send(). Signaling must contain that transport race rather than let
    // one failed peer terminate the process.
    return false;
  }
};

export const closeQuietly = (socket: CloseSocket, code?: number, reason?: string): void => {
  try {
    socket.close(code, reason);
  } catch {
    // Closing is best-effort. A concurrent transport failure must not escape
    // cleanup/session-shutdown paths and crash the signaling process.
  }
};

export const terminateQuietly = (socket: TerminateSocket): void => {
  try {
    socket.terminate();
  } catch {
    // Forced teardown can race an already-destroyed transport during shutdown.
  }
};
