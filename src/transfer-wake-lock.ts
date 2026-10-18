type WakeLockLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void, options?: AddEventListenerOptions) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockLike>;
  };
};

export class TransferWakeLock {
  private sentinel: WakeLockLike | null = null;
  private active = false;

  constructor(private readonly nav: WakeLockNavigator = navigator as WakeLockNavigator) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.active && !this.sentinel) {
        void this.acquire();
      }
    });
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) void this.acquire();
    else void this.release();
  }

  private async acquire(): Promise<void> {
    if (!this.active || this.sentinel || !this.nav.wakeLock || document.visibilityState !== "visible") return;
    try {
      const sentinel = await this.nav.wakeLock.request("screen");
      if (!this.active) {
        await sentinel.release();
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener("release", () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      }, { once: true });
    } catch (error) {
      console.debug("Bridge could not acquire a screen wake lock", error);
    }
  }

  private async release(): Promise<void> {
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel && !sentinel.released) {
      await sentinel.release().catch(() => undefined);
    }
  }
}
