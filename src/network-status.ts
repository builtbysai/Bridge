const CONNECTED_TITLES = new Set(["Device connected", "Ready to send"]);
const RESTORE_GRACE_MS = 500;

const connectionReady = (): boolean => {
  const title = document.querySelector<HTMLElement>("#connection-title");
  return Boolean(title?.textContent && CONNECTED_TITLES.has(title.textContent.trim()));
};

const transferControls = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>(
    "[data-action], #incoming-save, #incoming-memory, #incoming-reject, #request-fulfill, #request-decline"
  )
];

const syncTransferAvailability = (enabled: boolean) => {
  const disabled = !enabled;
  for (const button of transferControls()) {
    if (button.disabled !== disabled) button.disabled = disabled;
  }

  const dropZone = document.querySelector<HTMLElement>("#drop-zone");
  const ariaDisabled = String(disabled);
  if (dropZone?.getAttribute("aria-disabled") !== ariaDisabled) {
    dropZone?.setAttribute("aria-disabled", ariaDisabled);
  }
};

const installNetworkStatus = () => {
  const connectionCopy = document.querySelector<HTMLElement>(".connection > div");
  const connectionTitle = document.querySelector<HTMLElement>("#connection-title");
  if (!connectionCopy || !connectionTitle || document.querySelector("#network-status")) return;

  const status = document.createElement("small");
  status.id = "network-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  status.hidden = true;
  connectionCopy.append(status);

  let offline = !navigator.onLine;
  let transferPaused = offline;
  let restoreTimer: number | null = null;

  const clearRestoreTimer = () => {
    if (restoreTimer === null) return;
    window.clearTimeout(restoreTimer);
    restoreTimer = null;
  };

  const restoreIfReady = () => {
    if (!offline && navigator.onLine && connectionReady()) {
      transferPaused = false;
      syncTransferAvailability(true);
    }
  };

  const render = () => {
    offline = !navigator.onLine;
    transferPaused = true;
    clearRestoreTimer();

    if (offline) {
      status.hidden = false;
      status.textContent = "Network connection lost. Sending is paused until this browser is online again.";
      syncTransferAvailability(false);
      return;
    }

    status.hidden = false;
    status.textContent = "Network connection restored. Bridge will resume when the peer connection is ready.";
    syncTransferAvailability(false);
    restoreTimer = window.setTimeout(() => {
      restoreTimer = null;
      restoreIfReady();
    }, RESTORE_GRACE_MS);
  };

  window.addEventListener("offline", render);
  window.addEventListener("online", render);

  const availabilityGuard = new MutationObserver(() => {
    if (transferPaused) syncTransferAvailability(false);
  });
  availabilityGuard.observe(document.body, {
    attributes: true,
    attributeFilter: ["disabled", "aria-disabled"],
    childList: true,
    subtree: true
  });

  const connectionObserver = new MutationObserver(() => {
    if (!offline) restoreIfReady();
  });
  connectionObserver.observe(connectionTitle, { childList: true, characterData: true, subtree: true });

  if (offline) render();
};

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", installNetworkStatus, { once: true });
} else {
  installNetworkStatus();
}
