import { afterEach, describe, expect, it, vi } from "vitest";
import { RecoveryController } from "./recovery";

afterEach(() => {
  vi.useRealTimers();
});

describe("RecoveryController", () => {
  it("backs off between attempts and resets after recovery", async () => {
    vi.useFakeTimers();
    const attempts: number[] = [];
    const controller = new RecoveryController({
      onAttempt: attempt => {
        attempts.push(attempt);
        throw new Error("still offline");
      }
    }, { baseDelayMs: 100, maxDelayMs: 1_000, maxAttempts: 3 });

    controller.schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(attempts).toEqual([1]);

    await vi.advanceTimersByTimeAsync(200);
    expect(attempts).toEqual([1, 2]);

    controller.recovered();
    expect(controller.currentAttempt).toBe(0);
    expect(controller.currentState).toBe("idle");
  });

  it("stops after the configured maximum attempts", async () => {
    vi.useFakeTimers();
    const controller = new RecoveryController({
      onAttempt: () => {
        throw new Error("offline");
      }
    }, { baseDelayMs: 10, maxAttempts: 2 });

    controller.schedule(true);
    await vi.runAllTimersAsync();

    expect(controller.currentAttempt).toBe(2);
    expect(controller.currentState).toBe("exhausted");
  });

  it("coalesces duplicate scheduling requests", async () => {
    vi.useFakeTimers();
    const onAttempt = vi.fn();
    const controller = new RecoveryController({ onAttempt }, { baseDelayMs: 50 });

    controller.schedule();
    controller.schedule();
    controller.schedule();
    await vi.advanceTimersByTimeAsync(50);

    expect(onAttempt).toHaveBeenCalledTimes(1);
  });
});
