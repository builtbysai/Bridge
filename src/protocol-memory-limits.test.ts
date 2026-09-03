import { describe, expect, it } from "vitest";
import {
  MAX_CLIPBOARD_TRANSFER_BYTES,
  MAX_LINK_TRANSFER_BYTES,
  MAX_TEXT_TRANSFER_BYTES,
  decodeControl,
  encodeControl,
  type TransferKind
} from "./protocol";

const transferOffer = (kind: TransferKind, size: number) => ({
  type: "transfer-offer" as const,
  transferId: "123e4567-e89b-42d3-a456-426614174000",
  kind,
  name: kind === "file" ? "large.bin" : "Shared payload",
  mime: kind === "file" ? "application/octet-stream" : "text/plain;charset=utf-8",
  size,
  sha256: "ab".repeat(32),
  nonceHex: "cd".repeat(12)
});

describe("memory-backed transfer protocol limits", () => {
  it.each([
    ["text", MAX_TEXT_TRANSFER_BYTES],
    ["link", MAX_LINK_TRANSFER_BYTES],
    ["clipboard", MAX_CLIPBOARD_TRANSFER_BYTES]
  ] as const)("accepts %s payloads at the limit", (kind, limit) => {
    const encoded = encodeControl(transferOffer(kind, limit));
    expect(decodeControl(encoded)).toMatchObject({ kind, size: limit });
  });

  it.each([
    ["text", MAX_TEXT_TRANSFER_BYTES],
    ["link", MAX_LINK_TRANSFER_BYTES],
    ["clipboard", MAX_CLIPBOARD_TRANSFER_BYTES]
  ] as const)("rejects %s payloads above the limit", (kind, limit) => {
    expect(() => encodeControl(transferOffer(kind, limit + 1))).toThrow(/protocol limit/);
  });

  it("does not impose the memory-backed limit on streamed file offers", () => {
    const size = Number.MAX_SAFE_INTEGER;
    const encoded = encodeControl(transferOffer("file", size));
    expect(decodeControl(encoded)).toMatchObject({ kind: "file", size });
  });

  it("rejects an oversized remote offer during decode before transfer state is created", () => {
    const raw = JSON.stringify({
      ...transferOffer("link", MAX_LINK_TRANSFER_BYTES + 1),
      version: 1
    });
    expect(() => decodeControl(raw)).toThrow(/protocol limit/);
  });
});
