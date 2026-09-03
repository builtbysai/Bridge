import { describe, expect, it } from "vitest";
import { deriveSessionKey } from "./crypto";
import type { ReceiveSink } from "./receive-sink";
import { TransferEngine, type IncomingRequest } from "./transfer";

class FakeDataChannel extends EventTarget {
  binaryType: BinaryType = "arraybuffer";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  peer: FakeDataChannel | null = null;
  transform?: (data: string | ArrayBuffer | ArrayBufferView | Blob) => string | ArrayBuffer | ArrayBufferView | Blob;

  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
    if (!this.peer) throw new Error("Fake channel is not paired");
    const transformed = this.transform ? this.transform(data) : data;
    const payload = ArrayBuffer.isView(transformed)
      ? transformed.buffer.slice(transformed.byteOffset, transformed.byteOffset + transformed.byteLength)
      : transformed;
    queueMicrotask(() => {
      this.peer?.dispatchEvent(new MessageEvent("message", { data: payload }));
    });
  }

  close(): void {}
}

class RecordingSink implements ReceiveSink {
  readonly kind = "memory" as const;
  chunks: Uint8Array[] = [];
  aborted = false;

  async write(chunk: Uint8Array): Promise<void> {
    this.chunks.push(chunk.slice());
  }

  async close(): Promise<Blob> {
    return new Blob(this.chunks);
  }

  async abort(): Promise<void> {
    this.aborted = true;
    this.chunks = [];
  }
}

class DiskLikeSink implements ReceiveSink {
  readonly kind = "file-system" as const;
  bytes = 0;
  closed = false;

  async write(chunk: Uint8Array): Promise<void> {
    this.bytes += chunk.byteLength;
  }

  async close(): Promise<null> {
    this.closed = true;
    return null;
  }

  async abort(): Promise<void> {
    this.closed = true;
  }
}

const pairFakeChannels = (): [FakeDataChannel, FakeDataChannel] => {
  const left = new FakeDataChannel();
  const right = new FakeDataChannel();
  left.peer = right;
  right.peer = left;
  return [left, right];
};

const asRTC = (channel: FakeDataChannel): RTCDataChannel => channel as unknown as RTCDataChannel;

describe("TransferEngine", () => {
  it("encrypts, transfers, verifies, and reconstructs text", async () => {
    const [left, right] = pairFakeChannels();
    const key = await deriveSessionKey("11".repeat(32), "session-test");

    const received = new Promise<string>(resolve => {
      const receiver = new TransferEngine(asRTC(right), key, {
        onIncomingOffer: offer => receiver.accept(offer.transferId),
        onComplete: (_transferId, blob) => void blob.text().then(resolve)
      });
    });

    const sender = new TransferEngine(asRTC(left), key);
    await sender.offerText("hello from bridge", "text");

    await expect(received).resolves.toBe("hello from bridge");
  });

  it("streams file chunks into a caller-provided sink and verifies the result", async () => {
    const [left, right] = pairFakeChannels();
    const key = await deriveSessionKey("33".repeat(32), "stream-test");
    const sink = new RecordingSink();
    const source = new File([new Uint8Array(160_000).map((_, index) => index % 251)], "large.bin", {
      type: "application/octet-stream"
    });

    const completed = new Promise<Blob>(resolve => {
      const receiver = new TransferEngine(asRTC(right), key, {
        onIncomingOffer: offer => receiver.accept(offer.transferId, sink),
        onComplete: (_transferId, blob) => resolve(blob)
      }, 32 * 1024);
    });

    const sender = new TransferEngine(asRTC(left), key, {}, 32 * 1024);
    await sender.offerFile(source);
    const result = await completed;

    expect(sink.chunks.length).toBeGreaterThan(1);
    expect(result.size).toBe(source.size);
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(new Uint8Array(await source.arrayBuffer()));
    expect(sink.aborted).toBe(false);
  });

  it("reports file-system completion without materializing the received file as a Blob", async () => {
    const [left, right] = pairFakeChannels();
    const key = await deriveSessionKey("44".repeat(32), "disk-test");
    const sink = new DiskLikeSink();
    const source = new File([new Uint8Array(96_000).fill(7)], "video.bin", {
      type: "application/octet-stream"
    });

    const completed = new Promise<{ blob: Blob; kind: ReceiveSink["kind"] }>(resolve => {
      const receiver = new TransferEngine(asRTC(right), key, {
        onIncomingOffer: offer => receiver.accept(offer.transferId, sink),
        onComplete: (_transferId, blob, kind) => resolve({ blob, kind })
      }, 24 * 1024);
    });

    const sender = new TransferEngine(asRTC(left), key, {}, 24 * 1024);
    await sender.offerFile(source);
    const result = await completed;

    expect(sink.bytes).toBe(source.size);
    expect(sink.closed).toBe(true);
    expect(result.kind).toBe("file-system");
    expect(result.blob.size).toBe(0);
  });

  it("delivers receiver-initiated requests and decline responses", async () => {
    const [left, right] = pairFakeChannels();
    const key = await deriveSessionKey("22".repeat(32), "request-test");

    let incoming: IncomingRequest | null = null;
    let declinedReason: string | undefined;

    const requester = new TransferEngine(asRTC(left), key, {
      onRequestDeclined: (_requestId, reason) => {
        declinedReason = reason;
      }
    });
    const responder = new TransferEngine(asRTC(right), key, {
      onIncomingRequest: request => {
        incoming = request;
        responder.declineRequest(request.requestId, "Not available");
      }
    });

    requester.request("file");
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(incoming?.kind).toBe("file");
    expect(declinedReason).toBe("Not available");
  });

  it("rejects a transfer when the receiver declines it", async () => {
    const [left, right] = pairFakeChannels();
    const key = await deriveSessionKey("55".repeat(32), "reject-test");
    const receiver = new TransferEngine(asRTC(right), key, {
      onIncomingOffer: offer => receiver.reject(offer.transferId, "No thanks")
    });
    const sender = new TransferEngine(asRTC(left), key);

    await expect(sender.offerText("secret", "text")).rejects.toThrow("No thanks");
  });

  it("detects ciphertext corruption, aborts the sink, and cancels the sender", async () => {
    const [left, right] = pairFakeChannels();
    const key = await deriveSessionKey("66".repeat(32), "corrupt-test");
    const sink = new RecordingSink();
    let corrupted = false;
    let receiverError = "";
    let senderCancelled = false;

    left.transform = data => {
      if (!corrupted && data instanceof ArrayBuffer) {
        corrupted = true;
        const copy = new Uint8Array(data.slice(0));
        copy[copy.length - 1] ^= 0xff;
        return copy.buffer;
      }
      return data;
    };

    const receiver = new TransferEngine(asRTC(right), key, {
      onIncomingOffer: offer => receiver.accept(offer.transferId, sink),
      onError: (_id, error) => {
        receiverError = error.message;
      }
    }, 8);
    const sender = new TransferEngine(asRTC(left), key, {
      onCancelled: () => {
        senderCancelled = true;
      }
    }, 8);

    await expect(sender.offerText("corrupt me across several chunks", "text")).rejects.toThrow("Transfer cancelled");
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(receiverError.length).toBeGreaterThan(0);
    expect(sink.aborted).toBe(true);
    expect(senderCancelled).toBe(true);
  });

  it("rejects an out-of-order chunk and propagates cancellation", async () => {
    const [left, right] = pairFakeChannels();
    const key = await deriveSessionKey("77".repeat(32), "order-test");
    const sink = new RecordingSink();
    let changedIndex = false;
    let receiverError = "";

    left.transform = data => {
      if (!changedIndex && data instanceof ArrayBuffer) {
        changedIndex = true;
        const copy = data.slice(0);
        const view = new DataView(copy);
        const idLength = view.getUint16(0, false);
        view.setUint32(2 + idLength, 1, false);
        return copy;
      }
      return data;
    };

    const receiver = new TransferEngine(asRTC(right), key, {
      onIncomingOffer: offer => receiver.accept(offer.transferId, sink),
      onError: (_id, error) => {
        receiverError = error.message;
      }
    }, 8);
    const sender = new TransferEngine(asRTC(left), key, {}, 8);

    await expect(sender.offerText("out of order payload", "text")).rejects.toThrow("Transfer cancelled");
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(receiverError).toContain("Unexpected chunk 1; expected 0");
    expect(sink.aborted).toBe(true);
  });
});
