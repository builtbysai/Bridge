import { describe, expect, it } from "vitest";
import { deriveSessionKey } from "./crypto";
import { TransferEngine } from "./transfer";

class FakeDataChannel extends EventTarget {
  binaryType: BinaryType = "arraybuffer";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  peer: FakeDataChannel | null = null;
  readyState: RTCDataChannelState = "open";

  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
    if (!this.peer) throw new Error("Fake channel is not paired");
    const payload = ArrayBuffer.isView(data)
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data;
    queueMicrotask(() => this.peer?.dispatchEvent(new MessageEvent("message", { data: payload })));
  }
}

const pairFakeChannels = (): [RTCDataChannel, RTCDataChannel] => {
  const left = new FakeDataChannel();
  const right = new FakeDataChannel();
  left.peer = right;
  right.peer = left;
  return [left as unknown as RTCDataChannel, right as unknown as RTCDataChannel];
};

describe("TransferEngine outbound handles", () => {
  it("exposes the transfer ID before approval and cancels an approval wait", async () => {
    const [left, right] = pairFakeChannels();
    const key = await deriveSessionKey("77".repeat(32), "cancel-handle-test");
    let offeredId: string | null = null;
    let remoteCancelledId: string | null = null;

    new TransferEngine(right, key, {
      onIncomingOffer: offer => {
        offeredId = offer.transferId;
        // Deliberately leave the offer pending so the sender is waiting for approval.
      },
      onCancelled: transferId => {
        remoteCancelledId = transferId;
      }
    });

    const sender = new TransferEngine(left, key, {}, 8);
    const handle = sender.startFileTransfer(new File(["waiting for approval"], "pending.txt"));

    expect(handle.transferId).toMatch(/^[0-9a-f-]{36}$/i);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(offeredId).toBe(handle.transferId);

    handle.cancel("Cancelled from transfer queue");

    await expect(handle.completion).rejects.toThrow("Cancelled from transfer queue");
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(remoteCancelledId).toBe(handle.transferId);
  });

  it("can cancel while the file is still being hashed", async () => {
    const [left] = pairFakeChannels();
    const key = await deriveSessionKey("88".repeat(32), "cancel-hash-test");
    const sender = new TransferEngine(left, key, {}, 4);
    const handle = sender.startFileTransfer(new File([new Uint8Array(64)], "hashing.bin"));

    handle.cancel("Cancelled before offer");

    await expect(handle.completion).rejects.toThrow("Transfer cancelled");
  });
});
