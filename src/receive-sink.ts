export const DEFAULT_MAX_MEMORY_RECEIVE_BYTES = 256 * 1024 * 1024;

export interface ReceiveSink {
  readonly kind: "memory" | "file-system";
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<Blob | null>;
  abort(reason?: unknown): Promise<void>;
}

export class MemoryReceiveSink implements ReceiveSink {
  readonly kind = "memory" as const;
  private chunks: Uint8Array<ArrayBuffer>[] = [];
  private closed = false;
  private bytes = 0;

  constructor(
    private readonly mime: string,
    private readonly maxBytes = DEFAULT_MAX_MEMORY_RECEIVE_BYTES
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new Error("Memory receive limit must be a non-negative safe integer");
    }
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("Receive sink is closed");
    if (this.bytes + chunk.byteLength > this.maxBytes) {
      throw new Error("Transfer exceeds this browser's in-memory receive limit");
    }
    this.chunks.push(Uint8Array.from(chunk));
    this.bytes += chunk.byteLength;
  }

  async close(): Promise<Blob> {
    if (this.closed) throw new Error("Receive sink is closed");
    this.closed = true;
    const blob = new Blob(this.chunks, { type: this.mime });
    this.chunks = [];
    this.bytes = 0;
    return blob;
  }

  async abort(): Promise<void> {
    this.closed = true;
    this.chunks = [];
    this.bytes = 0;
  }
}

type WritableLike = {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
};

type FileHandleLike = {
  createWritable(): Promise<WritableLike>;
};

type SavePicker = (options?: {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}) => Promise<FileHandleLike>;

const SAFE_MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+*-]*(?:;[a-z0-9!#$&^_.+-]+=[a-z0-9!#$&^_.+*-]+)*$/i;

export class FileSystemReceiveSink implements ReceiveSink {
  readonly kind = "file-system" as const;
  private closed = false;

  private constructor(private readonly writable: WritableLike) {}

  static isSupported(): boolean {
    return typeof (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker === "function";
  }

  static async create(name: string, mime: string): Promise<FileSystemReceiveSink> {
    const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
    if (!picker) throw new Error("Streaming file save is not supported by this browser");

    const safeMime = SAFE_MIME.test(mime) ? mime : null;
    const handle = await picker({
      suggestedName: name,
      types: safeMime
        ? [{ description: "Received file", accept: { [safeMime]: [extensionFor(name)] } }]
        : undefined
    });
    const writable = await handle.createWritable();
    return new FileSystemReceiveSink(writable);
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("Receive sink is closed");
    await this.writable.write(chunk);
  }

  async close(): Promise<null> {
    if (this.closed) throw new Error("Receive sink is closed");
    this.closed = true;
    await this.writable.close();
    return null;
  }

  async abort(reason?: unknown): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.writable.abort(reason);
  }
}

const extensionFor = (name: string): string => {
  const match = /(?:\.[a-z0-9]{1,16})$/i.exec(name);
  return match?.[0] ?? ".bin";
};
