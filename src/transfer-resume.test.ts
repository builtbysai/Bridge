import { describe, expect, it } from "vitest";
import { deriveSessionKey } from "./crypto";
import { TransferEngine } from "./transfer";

class ReconnectableChannel extends EventTarget {
  binaryType: BinaryType = "arraybuffer";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  readyState: RTCDataChannelState = "open";
  peer: ReconnectableChannel | null = null;
  binarySends = 0;
  closeAfterBinarySend: number | null = null;

  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
    if (this.readyState !== "open") throw new Error("channel closed");
    if (!this.peer || this.peer.readyState !== "open") throw new Error("peer channel closed");

    const payload = ArrayBuffer.isView(data)
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data;

    if (payload instanceof ArrayBuffer) this.binarySends += 1;
    const peer = this.peer;
    queueMicrotask(() => peer.dispatchEvent(new MessageEvent("message", { data: payload })));

    if (payload instanceof ArrayBuffer && this.closeAfterBinarySend === this.binarySends) {
      queueMicrotask(() => {
        this.readyState = "closed";
        if (this.peer) this.peer.readyState = "closed";
        this.dispatchEvent(new Event("close"));
        this.peer?.dispatchEvent(new Event("close"));
      });
    }
  }

  close(): void {
    this.readyState = "closed";
    this.dispatchEvent(new Event("close"));
  }
}

const pair = (): [ReconnectableChannel, ReconnectableChannel] => {
  const left = new ReconnectableChannel();
  const right = new ReconnectableChannel();
  left.peer = right;
  right.peer = left;
  return [left, right];
};

const asRTC = (channel: ReconnectableChannel): RTCDataChannel => channel as unknown as RTCDataChannel;

describe("TransferEngine resume", () => {
  it("resumes from the receiver's verified next chunk after a replacement channel opens", async () => {
    const key = await deriveSessionKey("88".repeat(32), "resume-test");
    const [firstSenderChannel, firstReceiverChannel] = pair();
    firstSenderChannel.closeAfterBinarySend = 1;

    let resumedAt = -1;
    const completed = new Promise<string>(resolve => {
      const receiver = new TransferEngine(asRTC(firstReceiverChannel), key, {
        onIncomingOffer: offer => receiver.accept(offer.transferId),
        onComplete: (_id, blob) => void blob.text().then(resolve)
      }, 8);

      const sender = new TransferEngine(asRTC(firstSenderChannel), key, {
        onResumed: (_id, byteOffset) => {
          resumedAt = byteOffset;
        }
      }, 8);

      void sender.offerText("resume this payload after interruption", "text");

      setTimeout(() => {
        const [replacementSender, replacementReceiver] = pair();
        sender.attachChannel(asRTC(replacementSender));
        receiver.attachChannel(asRTC(replacementReceiver));
        replacementSender.dispatchEvent(new Event("open"));
        replacementReceiver.dispatchEvent(new Event("open"));
      }, 10);
    });

    await expect(completed).resolves.toBe("resume this payload after interruption");
    expect(resumedAt).toBe(8);
  });
});
