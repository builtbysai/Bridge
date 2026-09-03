export type RecoveryState = "idle" | "scheduled" | "recovering" | "exhausted";

export type RecoveryCallbacks = {
  onAttempt: (attempt: number) => void | Promise<void>;
  onState?: (state: RecoveryState, attempt: number) => void;
};

export type RecoveryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export class RecoveryController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private state: RecoveryState = "idle";

  constructor(
    private readonly callbacks: RecoveryCallbacks,
    private readonly options: RecoveryOptions = {}
  ) {}

  get currentAttempt(): number {
    return this.attempt;
  }

  get currentState(): RecoveryState {
    return this.state;
  }

  schedule(immediate = false): void {
    if (this.timer || this.state === "recovering" || this.state === "exhausted") return;

    const maxAttempts = this.options.maxAttempts ?? 5;
    if (this.attempt >= maxAttempts) {
      this.setState("exhausted");
      return;
    }

    const delay = immediate ? 0 : this.delayForAttempt(this.attempt + 1);
    this.setState("scheduled");
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runAttempt();
    }, delay);
  }

  recovered(): void {
    this.clearTimer();
    this.attempt = 0;
    this.setState("idle");
  }

  stop(): void {
    this.clearTimer();
    this.attempt = 0;
    this.setState("idle");
  }

  private async runAttempt(): Promise<void> {
    const maxAttempts = this.options.maxAttempts ?? 5;
    if (this.attempt >= maxAttempts) {
      this.setState("exhausted");
      return;
    }

    this.attempt += 1;
    this.setState("recovering");
    try {
      await this.callbacks.onAttempt(this.attempt);
      if (this.state === "recovering") {
        if (this.attempt >= maxAttempts) {
          this.setState("exhausted");
        } else {
          this.state = "idle";
          this.schedule();
        }
      }
    } catch {
      if (this.attempt >= maxAttempts) {
        this.setState("exhausted");
      } else {
        this.state = "idle";
        this.schedule();
      }
    }
  }

  private delayForAttempt(attempt: number): number {
    const base = this.options.baseDelayMs ?? 1_000;
    const cap = this.options.maxDelayMs ?? 8_000;
    return Math.min(base * 2 ** Math.max(0, attempt - 1), cap);
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private setState(state: RecoveryState): void {
    this.state = state;
    this.callbacks.onState?.(state, this.attempt);
  }
}
