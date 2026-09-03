import { sha256 } from "@noble/hashes/sha2.js";
import { bytesFromHex, bytesToHex, decryptChunk, encryptChunk, randomTransferNonce, sha256Hex } from "./crypto";
import {
  decodeControl,
  encodeControl,
  type ControlMessage,
  type ControlPayload,
  type TransferKind,
  type TransferOffer
} from "./protocol";
import { MemoryReceiveSink, type ReceiveSink } from "./receive-sink";

const DEFAULT_CHUNK_SIZE = 64 * 1024;
const DEFAULT_HIGH_WATER = 4 * 1024 * 1024;
const DEFAULT_LOW_WATER = 1 * 1024 * 1024;
const CHANNEL_WAIT_TIMEOUT_MS = 45_000;
const BACKPRESSURE_WAIT_TIMEOUT_MS = 30_000;
const ACCEPTANCE_TIMEOUT_MS = 120_000;
const VERIFICATION_TIMEOUT_MS = 30_000;
const RESUME_TIMEOUT_MS = 45_000;
const MAX_REMEMBERED_TRANSFER_IDS = 2_048;

export type { TransferKind } from "./protocol";

export type TransferProgress = {
  transferId: string;
  transferred: number;
  total: number;
  bytesPerSecond: number;
};

export type IncomingTransfer = Omit<TransferOffer, "type" | "version">;

export type IncomingRequest = {
  requestId: string;
  kind: TransferKind;
};

export type OutboundTransferHandle = {
  transferId: string;
  completion: Promise<string>;
  cancel: (reason?: string) => void;
};

type TransferCallbacks = {
  onIncomingOffer?: (offer: IncomingTransfer) => void;
  onIncomingRequest?: (request: IncomingRequest) => void;
  onRequestDeclined?: (requestId: string, reason?: string) => void;
  onProgress?: (progress: TransferProgress) => void;
  onComplete?: (transferId: string, blob: Blob, sinkKind: ReceiveSink["kind"]) => void;
  onError?: (transferId: string | null, error: Error) => void;
  onCancelled?: (transferId: string, reason?: string) => void;
  onResumed?: (transferId: string, byteOffset: number) => void;
};

type ReceiveState = {
  offer: IncomingTransfer;
  sink: ReceiveSink | null;
  hasher: ReturnType<typeof sha256.create>;
  received: number;
  expectedIndex: number;
  startedAt: number;
};

type SendGate = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

type ChannelWaiter = {
  transferId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type OutboundSource = File | Uint8Array<ArrayBuffer>;

type OutboundState = {
  offer: IncomingTransfer;
  source: OutboundSource;
  nonce: Uint8Array;
  nextChunkIndex: number;
  accepted: boolean;
  interrupted: boolean;
  resumeGate: SendGate | null;
  startedAt: number;
};

class ChannelInterruptedError extends Error {
  constructor(message = "Transfer channel was interrupted") {
    super(message);
    this.name = "ChannelInterruptedError";
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const transferAAD = (transferId: string, chunkIndex: number): string =>
  `bridge-transfer-v1:${transferId}:${chunkIndex}`;

const rememberBounded = (set: Set<string>, value: string): void => {
  set.delete(value);
  set.add(value);
  while (set.size > MAX_REMEMBERED_TRANSFER_IDS) {
    const oldest = set.values().next().value as string | undefined;
    if (!oldest) break;
    set.delete(oldest);
  }
};

export class TransferEngine {
  private channel: RTCDataChannel;
  private messageListener: ((event: MessageEvent) => void) | null = null;
  private closeListener: (() => void) | null = null;
  private openListener: (() => void) | null = null;
  private readonly channelWaiters = new Set<ChannelWaiter>();
  private readonly backpressureRejectors = new Set<(error: Error) => void>();
  private readonly receiveStates = new Map<string, ReceiveState>();
  private readonly acceptedTransfers = new Set<string>();
  private readonly completedReceives = new Set<string>();
  private readonly finalizingReceives = new Set<string>();
  private readonly cancelledTransfers = new Set<string>();
  private readonly pendingAccepts = new Map<string, SendGate>();
  private readonly pendingVerifications = new Map<string, SendGate>();
  private readonly outboundTransfers = new Map<string, OutboundState>();
  private messageQueue: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    channel: RTCDataChannel,
    private readonly sessionKey: CryptoKey,
    private readonly callbacks: TransferCallbacks = {},
    private readonly chunkSize = DEFAULT_CHUNK_SIZE
  ) {
    if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new Error("Transfer chunk size must be a positive safe integer");
    this.channel = channel;
    this.bindChannel(channel);
  }

  attachChannel(channel: RTCDataChannel): void {
    if (this.disposed) throw new Error("Transfer engine is closed");
    if (channel === this.channel) return;
    this.rejectBackpressureWaiters(new ChannelInterruptedError("Transfer channel was replaced"));
    this.unbindChannel(this.channel);
    this.channel = channel;
    this.bindChannel(channel);
    if (this.isChannelOpen()) this.handleChannelOpen();
  }

  close(reason = "Transfer session closed"): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unbindChannel(this.channel);
    const error = new Error(reason);

    for (const waiter of this.channelWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.channelWaiters.clear();
    this.rejectBackpressureWaiters(error);
    this.rejectAllGates(this.pendingAccepts, reason);
    this.rejectAllGates(this.pendingVerifications, reason);

    for (const state of this.outboundTransfers.values()) {
      this.rejectSendGate(state.resumeGate, error);
      state.resumeGate = null;
    }
    this.outboundTransfers.clear();

    for (const state of this.receiveStates.values()) {
      if (state.sink) void state.sink.abort(error).catch(() => undefined);
    }
    this.receiveStates.clear();
    this.acceptedTransfers.clear();
    this.finalizingReceives.clear();
  }

  startFileTransfer(file: File): OutboundTransferHandle {
    const transferId = crypto.randomUUID();
    const completion = this.prepareFileTransfer(transferId, file);
    return {
      transferId,
      completion,
      cancel: reason => this.cancel(transferId, reason)
    };
  }

  async offerFile(file: File): Promise<string> {
    return this.startFileTransfer(file).completion;
  }

  startTextTransfer(value: string, kind: Exclude<TransferKind, "file"> = "text"): OutboundTransferHandle {
    const transferId = crypto.randomUUID();
    const completion = this.prepareTextTransfer(transferId, value, kind);
    return {
      transferId,
      completion,
      cancel: reason => this.cancel(transferId, reason)
    };
  }

  async offerText(value: string, kind: Exclude<TransferKind, "file"> = "text"): Promise<string> {
    return this.startTextTransfer(value, kind).completion;
  }

  private async prepareFileTransfer(transferId: string, file: File): Promise<string> {
    this.assertUsable();
    const digest = await this.hashFile(file, transferId);
    if (this.cancelledTransfers.has(transferId)) throw new Error("Transfer cancelled");
    const nonce = randomTransferNonce();
    const offer: IncomingTransfer = {
      transferId,
      kind: "file",
      name: file.name || "file",
      mime: file.type || "application/octet-stream",
      size: file.size,
      sha256: digest,
      nonceHex: bytesToHex(nonce)
    };

    return this.offerSource(offer, file, nonce);
  }

  private async prepareTextTransfer(
    transferId: string,
    value: string,
    kind: Exclude<TransferKind, "file">
  ): Promise<string> {
    this.assertUsable();
    const label = kind === "link" ? "Shared link" : kind === "clipboard" ? "Clipboard" : "Text";
    const bytes = encoder.encode(value);
    const nonce = randomTransferNonce();
    const offer: IncomingTransfer = {
      transferId,
      kind,
      name: label,
      mime: "text/plain;charset=utf-8",
      size: bytes.byteLength,
      sha256: await sha256Hex(bytes),
      nonceHex: bytesToHex(nonce)
    };
    if (this.cancelledTransfers.has(transferId)) throw new Error("Transfer cancelled");
    return this.offerSource(offer, bytes, nonce);
  }

  request(kind: TransferKind): string {
    this.assertUsable();
    const requestId = crypto.randomUUID();
    this.sendControl({ type: "request-item", requestId, kind });
    return requestId;
  }

  declineRequest(requestId: string, reason?: string): void {
    this.assertUsable();
    this.sendControl({ type: "request-decline", requestId, reason });
  }

  accept(transferId: string, sink?: ReceiveSink): void {
    this.assertUsable();
    const state = this.receiveStates.get(transferId);
    if (!state) throw new Error("Unknown incoming transfer");
    if (this.acceptedTransfers.has(transferId)) throw new Error("Incoming transfer was already accepted");
    state.sink = sink ?? new MemoryReceiveSink(state.offer.mime);
    this.acceptedTransfers.add(transferId);
    this.sendControl({ type: "transfer-accept", transferId });
  }

  reject(transferId: string, reason?: string): void {
    const state = this.receiveStates.get(transferId);
    if (state?.sink) void state.sink.abort(reason).catch(() => undefined);
    this.receiveStates.delete(transferId);
    this.acceptedTransfers.delete(transferId);
    if (this.isChannelOpen()) {
      try { this.sendControl({ type: "transfer-reject", transferId, reason }); } catch { /* best effort */ }
    }
  }

  cancel(transferId: string, reason?: string): void {
    const message = reason ?? "Transfer cancelled";
    rememberBounded(this.cancelledTransfers, transferId);
    const state = this.receiveStates.get(transferId);
    if (state?.sink) void state.sink.abort(message).catch(() => undefined);
    this.receiveStates.delete(transferId);
    this.acceptedTransfers.delete(transferId);
    this.finalizingReceives.delete(transferId);

    const outbound = this.outboundTransfers.get(transferId);
    this.rejectSendGate(outbound?.resumeGate ?? null, new Error(message));
    this.outboundTransfers.delete(transferId);

    if (this.isChannelOpen() && !this.disposed) {
      try { this.sendControl({ type: "transfer-cancel", transferId, reason: message }); } catch { /* best effort */ }
    }
    this.rejectGate(this.pendingAccepts, transferId, message);
    this.rejectGate(this.pendingVerifications, transferId, message);
    this.rejectChannelWaiters(transferId, new Error(message));
  }

  private async offerSource(offer: IncomingTransfer, source: OutboundSource, nonce: Uint8Array): Promise<string> {
    this.assertUsable();
    if (this.cancelledTransfers.has(offer.transferId)) throw new Error("Transfer cancelled");
    const outbound: OutboundState = {
      offer,
      source,
      nonce,
      nextChunkIndex: 0,
      accepted: false,
      interrupted: false,
      resumeGate: null,
      startedAt: performance.now()
    };
    this.outboundTransfers.set(offer.transferId, outbound);

    try {
      await this.waitForChannel(offer.transferId);
      if (this.cancelledTransfers.has(offer.transferId)) throw new Error("Transfer cancelled");
      this.sendControl({ type: "transfer-offer", ...offer });
      await this.waitForAcceptance(offer.transferId);
      outbound.accepted = true;

      await this.sendOutbound(outbound);
      await this.sendCompletionAndVerify(outbound);
      this.outboundTransfers.delete(offer.transferId);
      return offer.transferId;
    } catch (error) {
      this.outboundTransfers.delete(offer.transferId);
      throw error;
    }
  }

  private async hashFile(file: File, transferId?: string): Promise<string> {
    const hasher = sha256.create();
    for (let offset = 0; offset < file.size; offset += this.chunkSize) {
      if (transferId && this.cancelledTransfers.has(transferId)) throw new Error("Transfer cancelled");
      const chunk = new Uint8Array(await file.slice(offset, Math.min(offset + this.chunkSize, file.size)).arrayBuffer());
      hasher.update(chunk);
    }
    return bytesToHex(hasher.digest());
  }

  private async sendOutbound(state: OutboundState): Promise<void> {
    const totalChunks = Math.ceil(state.offer.size / this.chunkSize);
    while (state.nextChunkIndex < totalChunks) {
      if (this.cancelledTransfers.has(state.offer.transferId)) throw new Error("Transfer cancelled");

      try {
        await this.waitForChannel(state.offer.transferId);
        if (state.interrupted) {
          const completed = await this.negotiateResume(state);
          if (completed) return;
        }
        await this.waitForBackpressure(state.offer.transferId);

        const index = state.nextChunkIndex;
        const start = index * this.chunkSize;
        const end = Math.min(start + this.chunkSize, state.offer.size);
        const plaintext = await this.readSourceChunk(state.source, start, end);
        await this.sendEncryptedChunk(state.offer, index, plaintext, state.nonce);

        state.nextChunkIndex = index + 1;
        this.emitProgress(state.offer.transferId, end, state.offer.size, state.startedAt);
      } catch (error) {
        if (this.cancelledTransfers.has(state.offer.transferId)) throw error;
        if (error instanceof ChannelInterruptedError || !this.isChannelOpen()) {
          state.interrupted = true;
          continue;
        }
        throw error;
      }
    }
  }

  private async sendCompletionAndVerify(state: OutboundState): Promise<void> {
    while (true) {
      await this.waitForChannel(state.offer.transferId);
      if (state.interrupted) {
        const completed = await this.negotiateResume(state);
        if (completed) return;
        if (state.nextChunkIndex < Math.ceil(state.offer.size / this.chunkSize)) {
          await this.sendOutbound(state);
        }
      }

      try {
        this.sendControl({ type: "transfer-complete", transferId: state.offer.transferId });
        await this.waitForVerification(state.offer.transferId);
        return;
      } catch (error) {
        if (this.cancelledTransfers.has(state.offer.transferId)) throw error;
        if (error instanceof ChannelInterruptedError || !this.isChannelOpen()) {
          state.interrupted = true;
          continue;
        }
        throw error;
      }
    }
  }

  private async negotiateResume(state: OutboundState): Promise<boolean> {
    if (!state.interrupted) return false;
    if (state.resumeGate) throw new Error("Transfer resume negotiation is already in progress");

    await this.waitForChannel(state.offer.transferId);
    return new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (state.resumeGate?.timer !== timer) return;
        state.resumeGate = null;
        reject(new Error("Timed out waiting for transfer resume state"));
      }, RESUME_TIMEOUT_MS);

      state.resumeGate = {
        timer,
        resolve: () => resolve(!this.outboundTransfers.has(state.offer.transferId)),
        reject
      };
      try {
        this.sendControl({ type: "transfer-resume-query", transferId: state.offer.transferId });
      } catch (error) {
        this.rejectSendGate(state.resumeGate, error instanceof Error ? error : new Error("Unable to request transfer resume"));
        state.resumeGate = null;
      }
    });
  }

  private async readSourceChunk(source: OutboundSource, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
    if (source instanceof Uint8Array) return source.subarray(start, end);
    return new Uint8Array(await source.slice(start, end).arrayBuffer());
  }

  private async sendEncryptedChunk(offer: IncomingTransfer, index: number, plaintext: Uint8Array<ArrayBuffer>, nonce: Uint8Array): Promise<void> {
    const encrypted = await encryptChunk(
      this.sessionKey,
      nonce,
      index,
      plaintext,
      transferAAD(offer.transferId, index)
    );
    if (!this.isChannelOpen()) throw new ChannelInterruptedError();
    this.channel.send(this.encodeChunk(offer.transferId, index, encrypted));
  }

  private enqueueMessage(data: unknown): void {
    const next = this.messageQueue.then(() => this.handleMessage(data));
    this.messageQueue = next.catch(error => {
      this.callbacks.onError?.(null, error instanceof Error ? error : new Error("Transfer message failed"));
    });
  }

  private async handleMessage(data: unknown): Promise<void> {
    if (this.disposed) return;
    if (typeof data === "string") {
      this.handleControl(decodeControl(data));
      return;
    }
    const buffer = data instanceof ArrayBuffer
      ? data
      : data instanceof Blob
        ? await data.arrayBuffer()
        : null;
    if (!buffer) throw new Error("Unsupported transfer message payload");
    await this.handleChunk(buffer);
  }

  private handleControl(message: ControlMessage): void {
    switch (message.type) {
      case "transfer-offer": {
        const { type: _type, version: _version, ...offer } = message;
        if (
          this.receiveStates.has(message.transferId)
          || this.completedReceives.has(message.transferId)
          || this.cancelledTransfers.has(message.transferId)
        ) {
          try {
            this.sendControl({ type: "transfer-reject", transferId: message.transferId, reason: "Duplicate transfer identifier" });
          } catch { /* best effort */ }
          return;
        }
        this.receiveStates.set(message.transferId, {
          offer,
          sink: null,
          hasher: sha256.create(),
          received: 0,
          expectedIndex: 0,
          startedAt: performance.now()
        });
        this.callbacks.onIncomingOffer?.(offer);
        return;
      }
      case "transfer-accept": {
        const gate = this.pendingAccepts.get(message.transferId);
        this.resolveGate(gate);
        this.pendingAccepts.delete(message.transferId);
        return;
      }
      case "transfer-reject":
        this.rejectGate(this.pendingAccepts, message.transferId, message.reason ?? "Transfer rejected");
        this.outboundTransfers.delete(message.transferId);
        return;
      case "transfer-cancel": {
        rememberBounded(this.cancelledTransfers, message.transferId);
        const state = this.receiveStates.get(message.transferId);
        if (state?.sink) void state.sink.abort(message.reason).catch(() => undefined);
        this.receiveStates.delete(message.transferId);
        this.acceptedTransfers.delete(message.transferId);
        this.finalizingReceives.delete(message.transferId);
        const outbound = this.outboundTransfers.get(message.transferId);
        this.rejectSendGate(outbound?.resumeGate ?? null, new Error(message.reason ?? "Transfer cancelled"));
        this.outboundTransfers.delete(message.transferId);
        this.rejectGate(this.pendingAccepts, message.transferId, message.reason ?? "Transfer cancelled");
        this.rejectGate(this.pendingVerifications, message.transferId, message.reason ?? "Transfer cancelled");
        this.rejectChannelWaiters(message.transferId, new Error(message.reason ?? "Transfer cancelled"));
        this.callbacks.onCancelled?.(message.transferId, message.reason);
        return;
      }
      case "transfer-complete":
        void this.finalizeReceive(message.transferId);
        return;
      case "transfer-verified": {
        const gate = this.pendingVerifications.get(message.transferId);
        this.resolveGate(gate);
        this.pendingVerifications.delete(message.transferId);
        return;
      }
      case "transfer-resume-query":
        this.replyResumeState(message.transferId);
        return;
      case "transfer-resume-state":
        this.applyResumeState(message);
        return;
      case "request-item":
        this.callbacks.onIncomingRequest?.({ requestId: message.requestId, kind: message.kind });
        return;
      case "request-decline":
        this.callbacks.onRequestDeclined?.(message.requestId, message.reason);
        return;
    }
  }

  private replyResumeState(transferId: string): void {
    if (this.completedReceives.has(transferId)) {
      this.sendControl({ type: "transfer-resume-state", transferId, nextChunkIndex: 0, completed: true });
      return;
    }
    const state = this.receiveStates.get(transferId);
    if (!state || !this.acceptedTransfers.has(transferId)) {
      this.sendControl({ type: "transfer-cancel", transferId, reason: "Receiver no longer has resumable transfer state" });
      return;
    }
    this.sendControl({
      type: "transfer-resume-state",
      transferId,
      nextChunkIndex: state.expectedIndex
    });
  }

  private applyResumeState(message: Extract<ControlMessage, { type: "transfer-resume-state" }>): void {
    const outbound = this.outboundTransfers.get(message.transferId);
    if (!outbound) return;
    if (message.completed) {
      this.outboundTransfers.delete(message.transferId);
      this.resolveGate(outbound.resumeGate);
      outbound.resumeGate = null;
      const verification = this.pendingVerifications.get(message.transferId);
      this.resolveGate(verification);
      this.pendingVerifications.delete(message.transferId);
      return;
    }

    const maxChunks = Math.ceil(outbound.offer.size / this.chunkSize);
    if (message.nextChunkIndex > maxChunks) {
      this.rejectSendGate(outbound.resumeGate, new Error("Receiver returned an invalid resume position"));
      outbound.resumeGate = null;
      return;
    }
    outbound.nextChunkIndex = message.nextChunkIndex;
    outbound.interrupted = false;
    this.callbacks.onResumed?.(
      message.transferId,
      Math.min(message.nextChunkIndex * this.chunkSize, outbound.offer.size)
    );
    this.resolveGate(outbound.resumeGate);
    outbound.resumeGate = null;
  }

  private async handleChunk(buffer: ArrayBuffer): Promise<void> {
    const view = new DataView(buffer);
    if (view.byteLength < 6) throw new Error("Malformed transfer chunk");
    const idLength = view.getUint16(0, false);
    if (idLength === 0 || idLength > 64) throw new Error("Malformed transfer chunk identifier");
    const headerLength = 2 + idLength + 4;
    if (buffer.byteLength <= headerLength) throw new Error("Malformed transfer chunk header");

    const transferId = decoder.decode(new Uint8Array(buffer, 2, idLength));
    const chunkIndex = view.getUint32(2 + idLength, false);
    const state = this.receiveStates.get(transferId);
    if (!state || !state.sink || !this.acceptedTransfers.has(transferId)) return;
    if (this.finalizingReceives.has(transferId)) return;
    if (chunkIndex !== state.expectedIndex) {
      await this.failReceive(transferId, new Error(`Unexpected chunk ${chunkIndex}; expected ${state.expectedIndex}`));
      return;
    }

    try {
      const ciphertext = buffer.slice(headerLength);
      const plaintext = await decryptChunk(
        this.sessionKey,
        bytesFromHex(state.offer.nonceHex),
        chunkIndex,
        ciphertext,
        transferAAD(transferId, chunkIndex)
      );
      const chunk = new Uint8Array(plaintext);
      if (state.received + chunk.byteLength > state.offer.size) {
        throw new Error("Transfer exceeded its declared size");
      }
      await state.sink.write(chunk);
      state.hasher.update(chunk);
      state.received += chunk.byteLength;
      state.expectedIndex += 1;
      this.emitProgress(transferId, state.received, state.offer.size, state.startedAt);
    } catch (error) {
      await this.failReceive(transferId, error instanceof Error ? error : new Error("Unable to store incoming chunk"));
    }
  }

  private async finalizeReceive(transferId: string): Promise<void> {
    if (this.completedReceives.has(transferId)) {
      if (this.isChannelOpen()) this.sendControl({ type: "transfer-verified", transferId });
      return;
    }
    if (this.finalizingReceives.has(transferId)) return;
    const state = this.receiveStates.get(transferId);
    if (!state || !state.sink || !this.acceptedTransfers.has(transferId)) return;

    this.finalizingReceives.add(transferId);
    try {
      if (state.received !== state.offer.size) throw new Error("Transfer size verification failed");
      const digest = bytesToHex(state.hasher.digest());
      if (digest !== state.offer.sha256) throw new Error("Transfer integrity verification failed");
      const sinkKind = state.sink.kind;
      const blob = await state.sink.close();
      this.receiveStates.delete(transferId);
      this.acceptedTransfers.delete(transferId);
      rememberBounded(this.completedReceives, transferId);
      if (this.isChannelOpen()) this.sendControl({ type: "transfer-verified", transferId });
      this.callbacks.onComplete?.(transferId, blob ?? new Blob([], { type: state.offer.mime }), sinkKind);
    } catch (error) {
      await this.failReceive(transferId, error instanceof Error ? error : new Error("Transfer verification failed"));
    } finally {
      this.finalizingReceives.delete(transferId);
    }
  }

  private async failReceive(transferId: string, error: Error): Promise<void> {
    const state = this.receiveStates.get(transferId);
    if (state?.sink) await state.sink.abort(error).catch(() => undefined);
    this.receiveStates.delete(transferId);
    this.acceptedTransfers.delete(transferId);
    this.finalizingReceives.delete(transferId);
    rememberBounded(this.cancelledTransfers, transferId);
    if (this.isChannelOpen() && !this.disposed) {
      try { this.sendControl({ type: "transfer-cancel", transferId, reason: error.message }); } catch { /* best effort */ }
    }
    this.callbacks.onError?.(transferId, error);
  }

  private encodeChunk(transferId: string, chunkIndex: number, encrypted: ArrayBuffer): ArrayBuffer {
    const id = encoder.encode(transferId);
    if (id.byteLength === 0 || id.byteLength > 64) throw new Error("Transfer identifier is too long");
    const output = new Uint8Array(2 + id.byteLength + 4 + encrypted.byteLength);
    const view = new DataView(output.buffer);
    view.setUint16(0, id.byteLength, false);
    output.set(id, 2);
    view.setUint32(2 + id.byteLength, chunkIndex, false);
    output.set(new Uint8Array(encrypted), 2 + id.byteLength + 4);
    return output.buffer;
  }

  private sendControl(message: ControlPayload): void {
    if (!this.isChannelOpen()) throw new ChannelInterruptedError("Transfer channel is not open");
    this.channel.send(encodeControl(message));
  }

  private waitForAcceptance(transferId: string): Promise<void> {
    return this.createTimedGate(this.pendingAccepts, transferId, ACCEPTANCE_TIMEOUT_MS, "Timed out waiting for recipient approval");
  }

  private waitForVerification(transferId: string): Promise<void> {
    return this.createTimedGate(this.pendingVerifications, transferId, VERIFICATION_TIMEOUT_MS, "Timed out waiting for transfer verification");
  }

  private createTimedGate(
    map: Map<string, SendGate>,
    transferId: string,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<void> {
    this.rejectGate(map, transferId, "Transfer gate replaced");
    return new Promise((resolve, reject) => {
      const gate: SendGate = {
        timer: null,
        resolve,
        reject
      };
      gate.timer = setTimeout(() => {
        if (map.get(transferId) !== gate) return;
        map.delete(transferId);
        gate.timer = null;
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      map.set(transferId, gate);
    });
  }

  private async waitForChannel(transferId: string): Promise<void> {
    if (this.disposed) throw new Error("Transfer engine is closed");
    if (this.cancelledTransfers.has(transferId)) throw new Error("Transfer cancelled");
    if (this.isChannelOpen()) return;

    await new Promise<void>((resolve, reject) => {
      const waiter: ChannelWaiter = {
        transferId,
        resolve: () => {
          clearTimeout(waiter.timer);
          this.channelWaiters.delete(waiter);
          resolve();
        },
        reject: error => {
          clearTimeout(waiter.timer);
          this.channelWaiters.delete(waiter);
          reject(error);
        },
        timer: setTimeout(() => undefined, 0)
      };
      clearTimeout(waiter.timer);
      waiter.timer = setTimeout(
        () => waiter.reject(new Error("Timed out waiting for transfer channel recovery")),
        CHANNEL_WAIT_TIMEOUT_MS
      );
      this.channelWaiters.add(waiter);
    });
  }

  private async waitForBackpressure(transferId: string): Promise<void> {
    if (this.cancelledTransfers.has(transferId)) throw new Error("Transfer cancelled");
    if (this.channel.bufferedAmount < DEFAULT_HIGH_WATER) return;

    const channel = this.channel;
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        channel.removeEventListener("bufferedamountlow", onLow);
        channel.removeEventListener("close", onClose);
        this.backpressureRejectors.delete(onExternalReject);
      };
      const succeed = () => {
        cleanup();
        resolve();
      };
      const fail = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onLow = () => succeed();
      const onClose = () => fail(new ChannelInterruptedError());
      const onExternalReject = (error: Error) => fail(error);

      channel.addEventListener("bufferedamountlow", onLow);
      channel.addEventListener("close", onClose, { once: true });
      this.backpressureRejectors.add(onExternalReject);
      timer = setTimeout(
        () => fail(new Error("Timed out waiting for WebRTC send-buffer backpressure")),
        BACKPRESSURE_WAIT_TIMEOUT_MS
      );
    });
  }

  private bindChannel(channel: RTCDataChannel): void {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = DEFAULT_LOW_WATER;
    this.messageListener = event => this.enqueueMessage(event.data);
    this.closeListener = () => this.handleChannelClose();
    this.openListener = () => this.handleChannelOpen();
    channel.addEventListener("message", this.messageListener);
    channel.addEventListener("close", this.closeListener);
    channel.addEventListener("open", this.openListener);
  }

  private unbindChannel(channel: RTCDataChannel): void {
    if (this.messageListener) channel.removeEventListener("message", this.messageListener);
    if (this.closeListener) channel.removeEventListener("close", this.closeListener);
    if (this.openListener) channel.removeEventListener("open", this.openListener);
  }

  private handleChannelOpen(): void {
    for (const waiter of [...this.channelWaiters]) waiter.resolve();
    for (const state of this.outboundTransfers.values()) {
      if (state.accepted) state.interrupted = true;
    }
  }

  private handleChannelClose(): void {
    this.rejectBackpressureWaiters(new ChannelInterruptedError());
    this.rejectAllGates(this.pendingVerifications, "Transfer channel interrupted");
    for (const state of this.outboundTransfers.values()) {
      if (state.accepted) state.interrupted = true;
      if (state.resumeGate) {
        this.rejectSendGate(state.resumeGate, new ChannelInterruptedError());
        state.resumeGate = null;
      }
    }
  }

  private isChannelOpen(): boolean {
    return this.channel.readyState === "open" || typeof this.channel.readyState === "undefined";
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error("Transfer engine is closed");
  }

  private rejectChannelWaiters(transferId: string, error: Error): void {
    for (const waiter of [...this.channelWaiters]) {
      if (waiter.transferId === transferId) waiter.reject(error);
    }
  }

  private rejectBackpressureWaiters(error: Error): void {
    for (const reject of [...this.backpressureRejectors]) reject(error);
  }

  private resolveGate(gate: SendGate | null | undefined): void {
    if (!gate) return;
    if (gate.timer) clearTimeout(gate.timer);
    gate.timer = null;
    gate.resolve();
  }

  private rejectSendGate(gate: SendGate | null | undefined, error: Error): void {
    if (!gate) return;
    if (gate.timer) clearTimeout(gate.timer);
    gate.timer = null;
    gate.reject(error);
  }

  private rejectGate(map: Map<string, SendGate>, transferId: string, reason: string): void {
    const gate = map.get(transferId);
    if (gate) this.rejectSendGate(gate, new Error(reason));
    map.delete(transferId);
  }

  private rejectAllGates(map: Map<string, SendGate>, reason: string): void {
    for (const [transferId, gate] of map) {
      this.rejectSendGate(gate, new Error(reason));
      map.delete(transferId);
    }
  }

  private emitProgress(transferId: string, transferred: number, total: number, startedAt: number): void {
    const seconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
    this.callbacks.onProgress?.({
      transferId,
      transferred,
      total,
      bytesPerSecond: transferred / seconds
    });
  }
}
