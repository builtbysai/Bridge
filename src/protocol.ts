export const PROTOCOL_VERSION = 1;

export const MAX_TRANSFER_NAME_LENGTH = 255;
export const MAX_TRANSFER_MIME_LENGTH = 255;
export const MAX_CONTROL_REASON_LENGTH = 512;
export const MAX_TEXT_TRANSFER_BYTES = 1024 * 1024;
export const MAX_LINK_TRANSFER_BYTES = 16 * 1024;
export const MAX_CLIPBOARD_TRANSFER_BYTES = 1024 * 1024;

export type TransferKind = "file" | "text" | "link" | "clipboard";

export type TransferOffer = {
  type: "transfer-offer";
  version: typeof PROTOCOL_VERSION;
  transferId: string;
  kind: TransferKind;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  nonceHex: string;
};

export type TransferAccept = {
  type: "transfer-accept";
  version: typeof PROTOCOL_VERSION;
  transferId: string;
};

export type TransferReject = {
  type: "transfer-reject";
  version: typeof PROTOCOL_VERSION;
  transferId: string;
  reason?: string;
};

export type TransferCancel = {
  type: "transfer-cancel";
  version: typeof PROTOCOL_VERSION;
  transferId: string;
  reason?: string;
};

export type TransferComplete = {
  type: "transfer-complete";
  version: typeof PROTOCOL_VERSION;
  transferId: string;
};

export type TransferVerified = {
  type: "transfer-verified";
  version: typeof PROTOCOL_VERSION;
  transferId: string;
};

export type TransferResumeQuery = {
  type: "transfer-resume-query";
  version: typeof PROTOCOL_VERSION;
  transferId: string;
};

export type TransferResumeState = {
  type: "transfer-resume-state";
  version: typeof PROTOCOL_VERSION;
  transferId: string;
  nextChunkIndex: number;
  completed?: boolean;
};

export type RequestItem = {
  type: "request-item";
  version: typeof PROTOCOL_VERSION;
  requestId: string;
  kind: TransferKind;
};

export type RequestDecline = {
  type: "request-decline";
  version: typeof PROTOCOL_VERSION;
  requestId: string;
  reason?: string;
};

export type ControlMessage =
  | TransferOffer
  | TransferAccept
  | TransferReject
  | TransferCancel
  | TransferComplete
  | TransferVerified
  | TransferResumeQuery
  | TransferResumeState
  | RequestItem
  | RequestDecline;

type WithoutVersion<T> = T extends unknown ? Omit<T, "version"> : never;
export type ControlPayload = WithoutVersion<ControlMessage>;

const TRANSFER_KINDS = new Set<TransferKind>(["file", "text", "link", "clipboard"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const NONCE_PATTERN = /^[0-9a-f]{24}$/i;

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Control message must be a JSON object");
  }
  return value as Record<string, unknown>;
};

const requireString = (
  record: Record<string, unknown>,
  key: string,
  { maxLength, allowEmpty = false }: { maxLength: number; allowEmpty?: boolean }
): string => {
  const value = record[key];
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > maxLength) {
    throw new Error(`Invalid control field ${key}`);
  }
  return value;
};

const optionalReason = (record: Record<string, unknown>): string | undefined => {
  const value = record.reason;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > MAX_CONTROL_REASON_LENGTH) {
    throw new Error("Invalid control field reason");
  }
  return value;
};

const requireTransferId = (record: Record<string, unknown>): string => {
  const transferId = requireString(record, "transferId", { maxLength: 64 });
  if (!UUID_PATTERN.test(transferId)) throw new Error("Invalid transferId");
  return transferId;
};

const requireRequestId = (record: Record<string, unknown>): string => {
  const requestId = requireString(record, "requestId", { maxLength: 64 });
  if (!UUID_PATTERN.test(requestId)) throw new Error("Invalid requestId");
  return requestId;
};

const requireKind = (record: Record<string, unknown>): TransferKind => {
  const kind = record.kind;
  if (typeof kind !== "string" || !TRANSFER_KINDS.has(kind as TransferKind)) {
    throw new Error("Invalid transfer kind");
  }
  return kind as TransferKind;
};

const requireSafeNonNegativeInteger = (record: Record<string, unknown>, key: string): number => {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid control field ${key}`);
  }
  return value;
};

const requireAllowedTransferSize = (kind: TransferKind, size: number): void => {
  const limit = kind === "link"
    ? MAX_LINK_TRANSFER_BYTES
    : kind === "text"
      ? MAX_TEXT_TRANSFER_BYTES
      : kind === "clipboard"
        ? MAX_CLIPBOARD_TRANSFER_BYTES
        : null;
  if (limit !== null && size > limit) {
    throw new Error(`Transfer ${kind} payload exceeds the ${limit}-byte protocol limit`);
  }
};

export const decodeControl = (raw: string): ControlMessage => {
  const record = asRecord(JSON.parse(raw) as unknown);
  if (record.version !== PROTOCOL_VERSION) throw new Error("Unsupported transfer protocol version");
  if (typeof record.type !== "string") throw new Error("Missing control message type");

  switch (record.type) {
    case "transfer-offer": {
      const transferId = requireTransferId(record);
      const kind = requireKind(record);
      const name = requireString(record, "name", { maxLength: MAX_TRANSFER_NAME_LENGTH });
      const mime = requireString(record, "mime", { maxLength: MAX_TRANSFER_MIME_LENGTH, allowEmpty: true });
      const size = requireSafeNonNegativeInteger(record, "size");
      requireAllowedTransferSize(kind, size);
      const sha256 = requireString(record, "sha256", { maxLength: 64 });
      const nonceHex = requireString(record, "nonceHex", { maxLength: 24 });
      if (!SHA256_PATTERN.test(sha256)) throw new Error("Invalid transfer SHA-256 digest");
      if (!NONCE_PATTERN.test(nonceHex)) throw new Error("Invalid transfer nonce");
      return { type: "transfer-offer", version: PROTOCOL_VERSION, transferId, kind, name, mime, size, sha256, nonceHex };
    }
    case "transfer-accept":
      return { type: "transfer-accept", version: PROTOCOL_VERSION, transferId: requireTransferId(record) };
    case "transfer-reject":
      return { type: "transfer-reject", version: PROTOCOL_VERSION, transferId: requireTransferId(record), reason: optionalReason(record) };
    case "transfer-cancel":
      return { type: "transfer-cancel", version: PROTOCOL_VERSION, transferId: requireTransferId(record), reason: optionalReason(record) };
    case "transfer-complete":
      return { type: "transfer-complete", version: PROTOCOL_VERSION, transferId: requireTransferId(record) };
    case "transfer-verified":
      return { type: "transfer-verified", version: PROTOCOL_VERSION, transferId: requireTransferId(record) };
    case "transfer-resume-query":
      return { type: "transfer-resume-query", version: PROTOCOL_VERSION, transferId: requireTransferId(record) };
    case "transfer-resume-state": {
      const completed = record.completed;
      if (completed !== undefined && typeof completed !== "boolean") throw new Error("Invalid control field completed");
      return {
        type: "transfer-resume-state",
        version: PROTOCOL_VERSION,
        transferId: requireTransferId(record),
        nextChunkIndex: requireSafeNonNegativeInteger(record, "nextChunkIndex"),
        completed
      };
    }
    case "request-item":
      return {
        type: "request-item",
        version: PROTOCOL_VERSION,
        requestId: requireRequestId(record),
        kind: requireKind(record)
      };
    case "request-decline":
      return {
        type: "request-decline",
        version: PROTOCOL_VERSION,
        requestId: requireRequestId(record),
        reason: optionalReason(record)
      };
    default:
      throw new Error("Unsupported control message type");
  }
};

export const encodeControl = (message: ControlPayload): string => {
  const raw = JSON.stringify({ ...message, version: PROTOCOL_VERSION });
  decodeControl(raw);
  return raw;
};
