export type QueueStatus = "queued" | "sending" | "completed" | "failed" | "cancelled";

export interface QueueProgress {
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export interface TransferQueueItem {
  id: string;
  file: File;
  status: QueueStatus;
  progress: QueueProgress;
  error?: string;
}

export interface TransferQueueSnapshot {
  items: readonly TransferQueueItem[];
  activeId: string | null;
  pendingCount: number;
}

export interface TransferQueueRunnerContext {
  signal: AbortSignal;
  onProgress: (progress: QueueProgress) => void;
}

export type TransferQueueRunner = (
  file: File,
  context: TransferQueueRunnerContext
) => Promise<void>;

export type TransferQueueListener = (snapshot: TransferQueueSnapshot) => void;

const makeId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `queue-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const cloneItem = (item: TransferQueueItem): TransferQueueItem => ({
  ...item,
  progress: { ...item.progress }
});

/**
 * Serial, UI-agnostic sender queue.
 *
 * WebRTC DataChannels already provide reliable ordered delivery while a
 * connection is alive. This queue deliberately limits Bridge to one file at a
 * time so the transfer engine's backpressure and resume state stay simple and
 * predictable on memory-constrained mobile browsers.
 */
export class TransferQueue {
  private readonly items: TransferQueueItem[] = [];
  private readonly listeners = new Set<TransferQueueListener>();
  private activeController: AbortController | null = null;
  private running = false;

  constructor(private readonly runner: TransferQueueRunner) {}

  subscribe(listener: TransferQueueListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  enqueue(files: Iterable<File>): string[] {
    const ids: string[] = [];
    for (const file of files) {
      const id = makeId();
      ids.push(id);
      this.items.push({
        id,
        file,
        status: "queued",
        progress: { transferred: 0, total: file.size, bytesPerSecond: 0 }
      });
    }
    if (ids.length > 0) {
      this.emit();
      void this.pump();
    }
    return ids;
  }

  cancel(id: string): boolean {
    const item = this.items.find(candidate => candidate.id === id);
    if (!item || item.status === "completed" || item.status === "failed" || item.status === "cancelled") {
      return false;
    }

    const wasActive = item.status === "sending";
    item.status = "cancelled";
    if (wasActive) this.activeController?.abort();
    this.emit();
    return true;
  }

  clearFinished(): void {
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const status = this.items[index].status;
      if (status === "completed" || status === "failed" || status === "cancelled") this.items.splice(index, 1);
    }
    this.emit();
  }

  snapshot(): TransferQueueSnapshot {
    return {
      items: this.items.map(cloneItem),
      activeId: this.activeId(),
      pendingCount: this.items.filter(item => item.status === "queued" || item.status === "sending").length
    };
  }

  private activeId(): string | null {
    return this.items.find(item => item.status === "sending")?.id ?? null;
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      while (true) {
        const item = this.items.find(candidate => candidate.status === "queued");
        if (!item) return;

        item.status = "sending";
        this.activeController = new AbortController();
        this.emit();

        try {
          await this.runner(item.file, {
            signal: this.activeController.signal,
            onProgress: progress => {
              if (item.status !== "sending") return;
              item.progress = {
                transferred: Math.max(0, Math.min(progress.transferred, progress.total)),
                total: progress.total,
                bytesPerSecond: Math.max(0, progress.bytesPerSecond)
              };
              this.emit();
            }
          });
          if (item.status === "sending") {
            item.status = "completed";
            item.progress = {
              transferred: item.progress.total,
              total: item.progress.total,
              bytesPerSecond: 0
            };
          }
        } catch (error) {
          const wasCancelled = this.activeController.signal.aborted;
          if (!wasCancelled) {
            item.status = "failed";
            item.error = error instanceof Error ? error.message : "Transfer failed";
          }
        } finally {
          this.activeController = null;
          this.emit();
        }
      }
    } finally {
      this.running = false;
      // An enqueue can race with the final empty-queue check above. Restart if
      // work arrived while the pump was unwinding.
      if (this.items.some(item => item.status === "queued")) void this.pump();
    }
  }
}

export const filesFromDrop = (dataTransfer: Pick<DataTransfer, "files">): File[] =>
  Array.from(dataTransfer.files).filter(file => file.size >= 0);
