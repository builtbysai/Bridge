import { describe, expect, it } from "vitest";
import { decodeControl, encodeControl, PROTOCOL_VERSION } from "./protocol";

const TRANSFER_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const NONCE = "cd".repeat(12);

describe("control protocol", () => {
  it("round-trips the production transfer offer shape", () => {
    const raw = encodeControl({
      type: "transfer-offer",
      transferId: TRANSFER_ID,
      kind: "file",
      name: "photo.jpg",
      mime: "image/jpeg",
      size: 42,
      sha256: "ab".repeat(32),
      nonceHex: NONCE
    });

    expect(decodeControl(raw)).toEqual({
      type: "transfer-offer",
      version: PROTOCOL_VERSION,
      transferId: TRANSFER_ID,
      kind: "file",
      name: "photo.jpg",
      mime: "image/jpeg",
      size: 42,
      sha256: "ab".repeat(32),
      nonceHex: NONCE
    });
  });

  it("round-trips request and resume controls", () => {
    expect(decodeControl(encodeControl({ type: "request-item", requestId: REQUEST_ID, kind: "clipboard" }))).toMatchObject({
      type: "request-item",
      requestId: REQUEST_ID,
      kind: "clipboard"
    });
    expect(decodeControl(encodeControl({
      type: "transfer-resume-state",
      transferId: TRANSFER_ID,
      nextChunkIndex: 7,
      completed: false
    }))).toMatchObject({
      type: "transfer-resume-state",
      transferId: TRANSFER_ID,
      nextChunkIndex: 7,
      completed: false
    });
  });

  it("rejects unsupported versions and unknown message types", () => {
    expect(() => decodeControl(`{"type":"transfer-accept","version":999,"transferId":"${TRANSFER_ID}"}`)).toThrow(/version/i);
    expect(() => decodeControl('{"type":"made-up","version":1}')).toThrow(/unsupported/i);
  });

  it("rejects malformed identifiers, sizes, hashes, nonces, and kinds", () => {
    expect(() => decodeControl('{"type":"transfer-accept","version":1,"transferId":"abc"}')).toThrow(/transferId/i);
    expect(() => decodeControl(`{"type":"request-item","version":1,"requestId":"${REQUEST_ID}","kind":"folder"}`)).toThrow(/kind/i);
    expect(() => decodeControl(`{"type":"transfer-offer","version":1,"transferId":"${TRANSFER_ID}","kind":"file","name":"x","mime":"","size":-1,"sha256":"${"ab".repeat(32)}","nonceHex":"${NONCE}"}`)).toThrow(/size/i);
    expect(() => decodeControl(`{"type":"transfer-offer","version":1,"transferId":"${TRANSFER_ID}","kind":"file","name":"x","mime":"","size":1,"sha256":"bad","nonceHex":"${NONCE}"}`)).toThrow(/SHA-256/i);
    expect(() => decodeControl(`{"type":"transfer-offer","version":1,"transferId":"${TRANSFER_ID}","kind":"file","name":"x","mime":"","size":1,"sha256":"${"ab".repeat(32)}","nonceHex":"bad"}`)).toThrow(/nonce/i);
  });

  it("rejects non-object JSON instead of casting it into a control message", () => {
    for (const raw of ["null", "[]", '"text"', "1", "true"]) {
      expect(() => decodeControl(raw)).toThrow(/object/i);
    }
  });
});
