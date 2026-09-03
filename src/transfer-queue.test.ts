import { describe, expect, it, vi } from "vitest";
import { TransferQueue, filesFromDrop } from "./transfer-queue";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

const makeFile = (name: string, size = 4): File =>
  new File([new Uint8Array(size)], name, { type: "application/octet-stream" });

describe("TransferQueue", () => {
  it("runs files serially and reports completion", async () => {
    const started: string[] = [];
    const release: Array<() => void> = [];
    const queue = new TransferQueue(async (file, { onProgress }) => {
      started.push(file.name);
      onProgress({ transferred: file.size / 2, total: file.size, bytesPerSecond: 1024 });
      await new Promise<void>(resolve => release.push(resolve));
    });

    queue.enqueue([makeFile("one.bin"), makeFile("two.bin")]);
    await tick();
    expect(started).toEqual(["one.bin"]);
    expect(queue.snapshot().pendingCount).toBe(2);

    release.shift()?.();
    await tick();
    expect(started).toEqual(["one.bin", "two.bin"]);
    expect(queue.snapshot().items[0].status).toBe("completed");

    release.shift()?.();
    await tick();
    expect(queue.snapshot().items.map(item => item.status)).toEqual(["completed", "completed"]);
    expect(queue.snapshot().pendingCount).toBe(0);
  });

  it("cancels a queued file without invoking the runner", async () => {
    const started: string[] = [];
    let releaseFirst!: () => void;
    const queue = new TransferQueue(async file => {
      started.push(file.name);
      await new Promise<void>(resolve => {
        if (file.name === "one.bin") releaseFirst = resolve;
        else resolve();
      });
    });

    const [, secondId] = queue.enqueue([makeFile("one.bin"), makeFile("two.bin")]);
    await tick();
    expect(queue.cancel(secondId)).toBe(true);
    releaseFirst();
    await tick();

    expect(started).toEqual(["one.bin"]);
    expect(queue.snapshot().items[1].status).toBe("cancelled");
  });

  it("aborts the active runner when the active item is cancelled", async () => {
    const aborted = vi.fn();
    const queue = new TransferQueue(async (_file, { signal }) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted();
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    });

    const [id] = queue.enqueue([makeFile("one.bin")]);
    await tick();
    expect(queue.cancel(id)).toBe(true);
    await tick();

    expect(aborted).toHaveBeenCalledOnce();
    expect(queue.snapshot().items[0].status).toBe("cancelled");
  });

  it("keeps failures isolated and continues with the next queued file", async () => {
    const started: string[] = [];
    const queue = new TransferQueue(async file => {
      started.push(file.name);
      if (file.name === "bad.bin") throw new Error("boom");
    });

    queue.enqueue([makeFile("bad.bin"), makeFile("good.bin")]);
    await tick();
    await tick();

    expect(started).toEqual(["bad.bin", "good.bin"]);
    expect(queue.snapshot().items.map(item => item.status)).toEqual(["failed", "completed"]);
    expect(queue.snapshot().items[0].error).toBe("boom");
  });

  it("clears only terminal items", async () => {
    let release!: () => void;
    const queue = new TransferQueue(async () => new Promise<void>(resolve => { release = resolve; }));
    queue.enqueue([makeFile("one.bin"), makeFile("two.bin")]);
    await tick();

    queue.clearFinished();
    expect(queue.snapshot().items).toHaveLength(2);

    release();
    await tick();
    const secondId = queue.snapshot().items[1].id;
    queue.cancel(secondId);
    queue.clearFinished();
    expect(queue.snapshot().items).toHaveLength(0);
  });
});

describe("filesFromDrop", () => {
  it("extracts dropped files", () => {
    const files = [makeFile("a.txt"), makeFile("b.txt")];
    expect(filesFromDrop({ files: files as unknown as FileList })).toEqual(files);
  });
});
