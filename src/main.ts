import QRCode from "qrcode";
import { displayDeviceName, loadDeviceName, MAX_DEVICE_NAME_LENGTH, saveDeviceName } from "./device-name";
import { isRelayOnlyPreferred, setRelayOnlyPreferred } from "./privacy-preference";
import { ProgressMilestoneAnnouncer } from "./transfer-announcements";
import { TransferWakeLock } from "./transfer-wake-lock";
import { parsePairingUrl, scanQrCode, ScanError, SECRET_PATTERN, SESSION_PATTERN } from "./qr-scanner";
import { BridgeSession, type BridgeSessionState } from "./bridge-session";
import { deriveSessionKey } from "./crypto";
import type { ConnectionRoute } from "./peer";
import { DEFAULT_MAX_MEMORY_RECEIVE_BYTES, FileSystemReceiveSink } from "./receive-sink";
import { decideTvMode, isTvModePreferred, isTvSizedViewport, setTvModePreferred, shouldAutoAcceptOnTv } from "./tv-mode";
import { createReceivePortalUrl, isReceivePortalUrl } from "./receive-portal";
import { filesFromDrop, TransferQueue, type TransferQueueSnapshot } from "./transfer-queue";
import { TransferEngine, type IncomingRequest, type IncomingTransfer, type TransferKind, type TransferProgress } from "./transfer";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

const randomSecret = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
};

const formatBytes = (value: number): string => {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unit]}`;
};

const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const currentUrl = new URL(window.location.href);
const params = currentUrl.searchParams;
const hash = new URLSearchParams(currentUrl.hash.slice(1));
const rawJoiningSession = params.get("session");
const rawJoiningSecret = hash.get("key");
const attemptedPairing = params.has("session") || hash.has("key") || params.get("portal") === "receive";
const joiningSession = rawJoiningSession && SESSION_PATTERN.test(rawJoiningSession) ? rawJoiningSession.toLowerCase() : null;
const joiningSecret = rawJoiningSecret && SECRET_PATTERN.test(rawJoiningSecret) ? rawJoiningSecret.toLowerCase() : null;
const pairingError = attemptedPairing && (!joiningSession || !joiningSecret)
  ? "This link is broken. Ask the sender for a new one."
  : null;
const isGuest = !pairingError && Boolean(joiningSession && joiningSecret);
const isReceivePortal = isGuest && isReceivePortalUrl(currentUrl);
const sessionSecret = joiningSecret ?? randomSecret();

// TV display mode (?tv=1): the instrument scaled for a living-room screen,
// receiving without prompts. The choice is remembered only on a TV-sized
// screen, so opening a TV link on a phone shows the layout for that visit
// and never sticks (see decideTvMode).
const tvDecision = decideTvMode(
  params,
  isTvModePreferred(),
  isTvSizedViewport(window.innerWidth, window.innerHeight)
);
const tvMode = tvDecision.enabled;
if (tvDecision.persist !== null && tvDecision.persist !== isTvModePreferred()) {
  setTvModePreferred(tvDecision.persist);
}
if (tvMode) document.body.classList.add("tv");

// Both devices are equal peers: anything one can send, the other can too.
// Only the receive-portal page is send-only, and only the host can mint a
// receive link.
const primaryActions = `
      <button data-action="send" disabled>Send files</button>
      <button data-action="send-text" disabled>Send text or a link</button>
      <button data-action="send-clipboard" disabled>Send clipboard</button>
      ${isReceivePortal ? "" : `
      <button data-action="request" disabled>Request something</button>
      <button data-action="receive" disabled>Copy receive link</button>`}
    `;

app.innerHTML = `
  <div class="stage">
    <div class="masthead">
      <span class="wordmark">Bridge <span class="alpha">alpha</span></span>
      <span class="sesscode" id="sesscode" hidden></span>
      <button type="button" class="gear" id="settings-toggle" aria-expanded="false" aria-controls="settings-panel">Settings</button>
      <span class="lamp" id="lamp" data-state="idle" aria-hidden="true"></span>
    </div>

    <div class="stagebody" id="stagebody">
      <div id="invite-block">
        <div class="qr" id="qr-wrap"><canvas id="qr" width="232" height="232"></canvas></div>
        <div class="invite-text">
        <p class="ask" id="ask">Scan with your other device.</p>
        <p class="code" id="session-code">SESSION <strong>&middot;&middot;&middot;&middot;</strong></p>
        <p class="tv-note" id="tv-note-invite" hidden>TV DISPLAY &middot; FILES FROM THE PAIRED DEVICE ARE RECEIVED AND SAVED AUTOMATICALLY</p>
        <div class="invite-actions" id="invite-actions" hidden>
          <button type="button" id="invite-scan">Scan to join</button>
          <button type="button" id="invite-copy">Copy invite link</button>
          <p class="hint">No camera? Send this link to the other device.</p>
        </div>
        </div>
      </div>
      <div id="link-block" hidden>
        <p class="peerline"><span id="peerline-local">THIS DEVICE</span> <strong>&larr;&rarr;</strong> <span id="peerline-peer">PAIRED DEVICE</span></p>
        <p class="route" id="route-line">ENCRYPTED</p>
        <p class="tv-note" id="tv-note-link" hidden>TV DISPLAY &middot; INCOMING FILES SAVE AUTOMATICALLY</p>
        ${isReceivePortal ? '<p class="portal-note">THIS PAGE ONLY SENDS</p>' : ''}
        <button class="drop" id="drop-zone" aria-disabled="true">
          <span>Drop files here<small>OR TAP TO CHOOSE</small></span>
        </button>
        <div class="actions">
          ${primaryActions}
          <input id="file-input" type="file" hidden multiple />
        </div>
      </div>
      <div id="note-block" hidden>
        <p class="ask" id="note-title">Ready</p>
        <p class="route" id="note-detail">WAITING TO START</p>
        <div class="actions" id="note-actions" hidden style="max-width:280px">
          <button id="note-retry">Start a new session</button>
        </div>
      </div>
    </div>

    <section class="panel" id="transfer-panel" hidden>
      <p class="xfer" id="transfer-title">Transfer</p>
      <p class="detail" id="transfer-detail"></p>
      <div class="xferbar" id="xferbar" role="progressbar" aria-labelledby="transfer-title" aria-describedby="transfer-detail" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="xferbar-fill"></i></div>
    </section>

    <section class="panel" id="queue-panel" hidden>
      <h2>Queue <span class="detail" id="queue-summary"></span></h2>
      <div class="qlist" id="queue-list"></div>
      <div class="row"><button id="queue-clear" type="button">Clear finished</button></div>
    </section>

    <section class="panel" id="incoming-panel" hidden aria-live="assertive">
      <h2 id="incoming-title">Incoming transfer</h2>
      <p class="detail" id="incoming-detail"></p>
      <div class="row">
        <button id="incoming-save" class="primary">Save to disk</button>
        <button id="incoming-memory">Receive in browser</button>
        <button id="incoming-reject" class="danger">Decline</button>
      </div>
    </section>

    <section class="panel" id="request-panel" hidden aria-live="polite">
      <h2 id="request-title">Incoming request</h2>
      <p class="detail" id="request-detail"></p>
      <div class="row">
        <button id="request-fulfill" class="primary">Choose</button>
        <button id="request-decline">Decline</button>
      </div>
    </section>

    <section class="panel" id="received-panel" hidden aria-live="polite">
      <h2 id="received-title">Received</h2>
      <pre id="received-content"></pre>
      <div class="row">
        <button id="received-copy">Copy</button>
        <a class="btn" id="received-open" href="#" target="_blank" rel="noopener noreferrer" hidden>Open link</a>
      </div>
    </section>

    <section class="panel" id="picker-panel" hidden>
      <h2>What do you want from the other device?</h2>
      <div class="row" id="picker-options">
        <button type="button" data-request-kind="file">A file</button>
        <button type="button" data-request-kind="text">Text</button>
        <button type="button" data-request-kind="link">A link</button>
        <button type="button" data-request-kind="clipboard">Their clipboard</button>
        <button type="button" id="picker-cancel">Cancel</button>
      </div>
    </section>

    <form class="panel" id="compose-panel" hidden>
      <h2 id="compose-title">Compose</h2>
      <textarea id="compose-input" rows="4" spellcheck="false" aria-labelledby="compose-title"></textarea>
      <div class="row">
        <button type="submit" class="primary" id="compose-submit">Send</button>
        <button type="button" id="compose-cancel">Cancel</button>
      </div>
    </form>

    <section class="panel" id="settings-panel" hidden>
      <h2>Settings</h2>
      <form class="setting" id="device-name-form">
        <label for="device-name-input">Device name</label>
        <div class="fields">
          <input id="device-name-input" type="text" maxlength="${MAX_DEVICE_NAME_LENGTH}" autocomplete="off" spellcheck="false" aria-describedby="device-name-help" />
          <button type="submit">Save</button>
        </div>
        <p class="hint" id="device-name-help">Shown to the other device. Stored only in this browser; blank uses an automatic label.</p>
      </form>
      <div class="setting">
        <label class="check" for="relay-only-toggle">
          <input id="relay-only-toggle" type="checkbox" aria-describedby="relay-only-help relay-only-status" />
          <span>Relay-only privacy mode</span>
        </label>
        <p class="hint" id="relay-only-help">Route everything through the TURN relay so the devices never connect directly and never see each other's network address.</p>
        <p class="hint" id="relay-only-status" role="status"></p>
        <div class="row" id="relay-only-actions" hidden><button type="button" id="relay-only-restart">Restart session now</button></div>
      </div>
      <div class="setting">
        <label>TV display</label>
        <p class="hint" id="tv-display-help">Couch-scale layout: a pairing code you can read across the room, and incoming files saved automatically. On a TV-sized screen this browser remembers the choice. On a smaller screen it applies to this visit only.</p>
        <div class="row"><button type="button" id="tv-display-toggle">${tvMode ? "Exit TV display" : "Use as TV display"}</button></div>
      </div>
    </section>

    <p class="sr-only" id="transfer-status" role="status" aria-live="polite" aria-atomic="true"></p>

    <p class="toast" id="toast" role="status" aria-live="polite" hidden></p>

    <div class="statusline">
      <span><span class="st" id="st" data-state="idle">READY</span> &middot; <span id="st-sub">WAITING TO START</span></span>
      <span id="st-exp"></span>
    </div>
  </div>
`;

const canvas = document.querySelector<HTMLCanvasElement>("#qr");
const code = document.querySelector<HTMLElement>("#session-code");
const sesscode = document.querySelector<HTMLElement>("#sesscode");
const stExp = document.querySelector<HTMLElement>("#st-exp");
const stagebody = document.querySelector<HTMLElement>("#stagebody");
const inviteBlock = document.querySelector<HTMLElement>("#invite-block");
const linkBlock = document.querySelector<HTMLElement>("#link-block");
const noteBlock = document.querySelector<HTMLElement>("#note-block");
const noteTitle = document.querySelector<HTMLElement>("#note-title");
const noteDetail = document.querySelector<HTMLElement>("#note-detail");
const askEl = document.querySelector<HTMLElement>("#ask");
const qrWrap = document.querySelector<HTMLElement>("#qr-wrap");
const noteActions = document.querySelector<HTMLElement>("#note-actions");
const noteRetry = document.querySelector<HTMLButtonElement>("#note-retry");
noteRetry?.addEventListener("click", () => window.location.reload());
const stWord = document.querySelector<HTMLElement>("#st");
const stSub = document.querySelector<HTMLElement>("#st-sub");
const lamp = document.querySelector<HTMLElement>("#lamp");
const routeLine = document.querySelector<HTMLElement>("#route-line");
const peerlineLocal = document.querySelector<HTMLElement>("#peerline-local");
const peerlinePeer = document.querySelector<HTMLElement>("#peerline-peer");
const transferPanel = document.querySelector<HTMLElement>("#transfer-panel");
const transferTitle = document.querySelector<HTMLElement>("#transfer-title");
const transferDetail = document.querySelector<HTMLElement>("#transfer-detail");
const xferFill = document.querySelector<HTMLElement>("#xferbar-fill");
const incomingPanel = document.querySelector<HTMLElement>("#incoming-panel");
const incomingTitle = document.querySelector<HTMLElement>("#incoming-title");
const incomingDetail = document.querySelector<HTMLElement>("#incoming-detail");
const incomingSave = document.querySelector<HTMLButtonElement>("#incoming-save");
const incomingMemory = document.querySelector<HTMLButtonElement>("#incoming-memory");
const incomingReject = document.querySelector<HTMLButtonElement>("#incoming-reject");
const requestPanel = document.querySelector<HTMLElement>("#request-panel");
const requestTitle = document.querySelector<HTMLElement>("#request-title");
const requestDetail = document.querySelector<HTMLElement>("#request-detail");
const requestFulfill = document.querySelector<HTMLButtonElement>("#request-fulfill");
const requestDecline = document.querySelector<HTMLButtonElement>("#request-decline");
const receivedPanel = document.querySelector<HTMLElement>("#received-panel");
const receivedTitle = document.querySelector<HTMLElement>("#received-title");
const receivedContent = document.querySelector<HTMLElement>("#received-content");
const receivedCopy = document.querySelector<HTMLButtonElement>("#received-copy");
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const dropZone = document.querySelector<HTMLElement>("#drop-zone");
const queuePanel = document.querySelector<HTMLElement>("#queue-panel");
const queueList = document.querySelector<HTMLElement>("#queue-list");
const queueSummary = document.querySelector<HTMLElement>("#queue-summary");
const queueClear = document.querySelector<HTMLButtonElement>("#queue-clear");
const inviteActions = document.querySelector<HTMLElement>("#invite-actions");
const inviteCopy = document.querySelector<HTMLButtonElement>("#invite-copy");
const inviteScan = document.querySelector<HTMLButtonElement>("#invite-scan");
const receivedOpen = document.querySelector<HTMLAnchorElement>("#received-open");
const pickerPanel = document.querySelector<HTMLElement>("#picker-panel");
const pickerCancel = document.querySelector<HTMLButtonElement>("#picker-cancel");
const composePanel = document.querySelector<HTMLFormElement>("#compose-panel");
const composeTitle = document.querySelector<HTMLElement>("#compose-title");
const composeInput = document.querySelector<HTMLTextAreaElement>("#compose-input");
const composeSubmit = document.querySelector<HTMLButtonElement>("#compose-submit");
const composeCancel = document.querySelector<HTMLButtonElement>("#compose-cancel");
const toastEl = document.querySelector<HTMLElement>("#toast");
const settingsToggle = document.querySelector<HTMLButtonElement>("#settings-toggle");
const settingsPanel = document.querySelector<HTMLElement>("#settings-panel");
const deviceNameForm = document.querySelector<HTMLFormElement>("#device-name-form");
const deviceNameInput = document.querySelector<HTMLInputElement>("#device-name-input");
const relayToggle = document.querySelector<HTMLInputElement>("#relay-only-toggle");
const relayStatus = document.querySelector<HTMLElement>("#relay-only-status");
const relayActions = document.querySelector<HTMLElement>("#relay-only-actions");
const relayRestart = document.querySelector<HTMLButtonElement>("#relay-only-restart");
const xferBar = document.querySelector<HTMLElement>("#xferbar");
const transferStatus = document.querySelector<HTMLElement>("#transfer-status");
const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-action]")];

// guest joining: no QR to show — the code is the invitation
const localName = displayDeviceName().toUpperCase();
if (peerlineLocal) peerlineLocal.textContent = localName || "THIS DEVICE";


if ((isGuest || pairingError) && qrWrap) qrWrap.hidden = true;
if (isGuest && askEl) askEl.textContent = "Joining session.";
if (isReceivePortal && askEl) askEl.textContent = "Send something to this device.";
if (tvMode) {
  if (!isGuest && !isReceivePortal && askEl) askEl.textContent = "Point your phone camera at the code.";
  // A TV has no camera to scan with: the other device does the scanning.
  if (inviteScan) inviteScan.hidden = true;
  for (const id of ["tv-note-invite", "tv-note-link"]) {
    const note = document.querySelector<HTMLElement>(`#${id}`);
    if (note) note.hidden = false;
  }
}

if (incomingSave && !FileSystemReceiveSink.isSupported()) incomingSave.hidden = true;

let sessionState: BridgeSessionState = "idle";
let channel: RTCDataChannel | null = null;
let engine: TransferEngine | null = null;
let keyPromise: Promise<CryptoKey> | null = null;
let pairingUrl: URL | null = null;
let pendingRequest: IncomingRequest | null = null;
let outgoingRequestId: string | null = null;
let outgoingRequestKind: TransferKind | null = null;
let pendingOffer: IncomingTransfer | null = null;
let pendingFileRequest = false;
let activeQueueProgress: ((progress: TransferProgress) => void) | null = null;
const transferNames = new Map<string, string>();
const transferOffers = new Map<string, IncomingTransfer>();

const queue = new TransferQueue(async (file, { signal, onProgress }) => {
  const transferEngine = engine;
  if (!transferEngine || sessionState !== "connected") throw new Error("Not connected yet");
  if (signal.aborted) throw new DOMException("Transfer cancelled", "AbortError");

  activeQueueProgress = progress => onProgress({
    transferred: progress.transferred,
    total: progress.total,
    bytesPerSecond: progress.bytesPerSecond
  });
  const handle = transferEngine.startFileTransfer(file);
  transferNames.set(handle.transferId, file.name);
  const cancelActiveTransfer = () => handle.cancel("Cancelled by sender");
  signal.addEventListener("abort", cancelActiveTransfer, { once: true });
  try {
    await handle.completion;
  } finally {
    signal.removeEventListener("abort", cancelActiveTransfer);
    transferNames.delete(handle.transferId);
    activeQueueProgress = null;
  }
});

const queueStatusLabel = (status: TransferQueueSnapshot["items"][number]["status"]): string => ({
  queued: "Queued",
  sending: "Sending",
  completed: "Sent",
  failed: "Failed",
  cancelled: "Cancelled"
})[status];

const renderQueue = (snapshot: TransferQueueSnapshot) => {
  if (!queuePanel || !queueList || !queueSummary) return;
  queuePanel.hidden = snapshot.items.length === 0;
  queueSummary.textContent = snapshot.pendingCount > 0
    ? `\u00b7 ${snapshot.pendingCount} REMAINING`
    : "\u00b7 COMPLETE";
  queueList.innerHTML = snapshot.items.map(item => {
    const canCancel = item.status === "queued" || item.status === "sending";
    const detailText = item.status === "failed"
      ? item.error ?? "Transfer failed"
      : item.status === "sending"
        ? `${formatBytes(item.progress.transferred)} / ${formatBytes(item.progress.total)} \u00b7 ${formatBytes(item.progress.bytesPerSecond)}/s`
        : formatBytes(item.file.size);
    return `
      <div class="qrow" data-queue-id="${item.id}" data-status="${item.status}">
        <span class="nm" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</span>
        <span class="st2">${queueStatusLabel(item.status).toUpperCase()} \u00b7 ${escapeHtml(detailText)}</span>
        ${canCancel ? `<button type="button" data-queue-cancel="${item.id}">${item.status === "sending" ? "CANCEL" : "REMOVE"}</button>` : ""}
      </div>
    `;
  }).join("");
};

queue.subscribe(renderQueue);
queueList?.addEventListener("click", event => {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>("[data-queue-cancel]");
  const id = button?.dataset.queueCancel;
  if (id) queue.cancel(id);
});
queueClear?.addEventListener("click", () => queue.clearFinished());

// Inline replacements for window.alert / window.prompt: native dialogs block
// the page, look foreign on phones, and (for prompt) force the user to type
// a keyword like "file" just to make a request.
let toastTimer: number | undefined;
const notify = (message: string) => {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastEl.hidden = true; }, 6_000);
};

// Clipboard writes fail without permission or on insecure origins; fall back
// to showing the text selected so it can still be copied by hand.
const copyText = async (value: string, success: string, fallbackTitle: string) => {
  try {
    await navigator.clipboard.writeText(value);
    notify(success);
  } catch {
    await openComposer(fallbackTitle, { value, submitLabel: "Done", readOnly: true });
  }
};

let composeResolve: ((value: string | null) => void) | null = null;
const closeComposer = (value: string | null) => {
  if (composePanel) composePanel.hidden = true;
  const resolve = composeResolve;
  composeResolve = null;
  resolve?.(value);
};
const openComposer = (title: string, options: { value?: string; submitLabel?: string; readOnly?: boolean } = {}): Promise<string | null> => {
  closeComposer(null);
  if (!composePanel || !composeInput || !composeTitle || !composeSubmit) return Promise.resolve(null);
  composeTitle.textContent = title;
  composeInput.value = options.value ?? "";
  composeInput.readOnly = options.readOnly ?? false;
  composeSubmit.textContent = options.submitLabel ?? "Send";
  composePanel.hidden = false;
  composeInput.focus();
  if (options.value) composeInput.select();
  return new Promise(resolve => { composeResolve = resolve; });
};
composePanel?.addEventListener("submit", event => {
  event.preventDefault();
  const value = composeInput?.value ?? "";
  if (!composeInput?.readOnly && value.trim().length === 0) {
    composeInput?.focus();
    return;
  }
  closeComposer(value);
});
composeCancel?.addEventListener("click", () => closeComposer(null));
composeInput?.addEventListener("keydown", event => {
  if (event.key === "Escape") closeComposer(null);
  else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) composePanel?.requestSubmit();
});

let pickerResolve: ((kind: TransferKind | null) => void) | null = null;
const closePicker = (kind: TransferKind | null) => {
  if (pickerPanel) pickerPanel.hidden = true;
  const resolve = pickerResolve;
  pickerResolve = null;
  resolve?.(kind);
};
const askRequestKind = (): Promise<TransferKind | null> => {
  closePicker(null);
  if (!pickerPanel) return Promise.resolve(null);
  pickerPanel.hidden = false;
  pickerPanel.querySelector<HTMLButtonElement>("button")?.focus();
  return new Promise(resolve => { pickerResolve = resolve; });
};
pickerPanel?.addEventListener("click", event => {
  const kind = (event.target as HTMLElement).closest<HTMLElement>("[data-request-kind]")?.dataset.requestKind;
  if (kind) closePicker(kind as TransferKind);
});
pickerCancel?.addEventListener("click", () => closePicker(null));
pickerPanel?.addEventListener("keydown", event => { if (event.key === "Escape") closePicker(null); });

const resetTransferState = (reason: string) => {
  setTransferActive(false);
  closeComposer(null);
  closePicker(null);
  engine?.close(reason);
  engine = null;
  channel = null;
  pendingOffer = null;
  pendingRequest = null;
  outgoingRequestId = null;
  outgoingRequestKind = null;
  pendingFileRequest = false;
  activeQueueProgress = null;
  transferNames.clear();
  transferOffers.clear();
  if (incomingPanel) incomingPanel.hidden = true;
  if (requestPanel) requestPanel.hidden = true;
};

const showBlock = (id: "invite-block" | "link-block" | "note-block") => {
  if (inviteBlock) inviteBlock.hidden = id !== "invite-block";
  if (linkBlock) linkBlock.hidden = id !== "link-block";
  if (noteBlock) noteBlock.hidden = id !== "note-block";
  if (stagebody) stagebody.classList.toggle("left", id === "link-block");
  if (sesscode) sesscode.hidden = id === "invite-block";
};

const setState = (state: BridgeSessionState, message?: string) => {
  const previous = sessionState;
  sessionState = state;
  if ((state === "waiting" && previous === "connected") || state === "closed" || state === "error") {
    resetTransferState(message ?? `Bridge session ${state}`);
  }

  if (!stWord || !stSub) return;
  const labels: Record<BridgeSessionState, [block: string, word: string, sub: string, note?: string, noteSub?: string]> = {
    idle: ["note-block", "READY", "WAITING TO START", "Ready", "WAITING TO START"],
    signaling: ["note-block", "CONNECTING", "SETTING UP THE ENCRYPTED LINK", "Connecting\u2026", "SETTING UP THE ENCRYPTED LINK"],
    waking: ["note-block", "WAKING", "RETRYING AUTOMATICALLY", "Waking up\u2026", "RETRYING AUTOMATICALLY"],
    waiting: ["invite-block", "WAITING", "LINK OPEN"],
    connecting: ["note-block", "CONNECTING", "PEER FOUND", "Device found", "CONNECTING\u2026"],
    connected: ["link-block", "LIVE", "2 PEERS"],
    closed: ["note-block", "ENDED", "NOTHING REMAINS", "Session ended.", "NOTHING REMAINS"],
    error: ["note-block", "FAILED", "CONNECTION FAILED", message ?? "Couldn't connect", message ? "" : "CHECK YOUR CONNECTION AND TRY AGAIN"]
  };
  const [block, word, sub, note, noteSub] = labels[state];
  showBlock(block as "invite-block" | "link-block" | "note-block");
  stWord.textContent = word;
  stWord.dataset.state = state;
  stSub.textContent = sub;
  if (lamp) lamp.dataset.state = state;
  if (noteTitle && note !== undefined) noteTitle.textContent = note;
  if (noteDetail && noteSub !== undefined) noteDetail.textContent = noteSub;
  if (noteActions) noteActions.hidden = state !== "closed" && state !== "error";
  syncControls();
  // A TV receiver waits with its session open: hold the screen awake from
  // the moment the invite is up until the session ends.
  tvWakeLock?.setActive(state === "waiting" || state === "connecting" || state === "connected");
  if (tvMode && state === "connected") dropZone?.focus();
};

// Controls are live only while connected AND the browser is online: a
// transfer can't progress offline, so don't invite one.
const syncControls = () => {
  const enabled = sessionState === "connected" && navigator.onLine;
  for (const button of buttons) button.disabled = !enabled;
  if (dropZone) dropZone.setAttribute("aria-disabled", String(!enabled));
};
window.addEventListener("offline", () => {
  syncControls();
  if (sessionState === "connected") notify("You're offline. Transfers are paused until the connection returns.");
});
window.addEventListener("online", () => {
  syncControls();
  if (sessionState === "connected") notify("Back online.");
});

const setRoute = (route: ConnectionRoute) => {
  if (!routeLine) return;
  routeLine.textContent = route === "direct" ? "DIRECT \u00b7 ENCRYPTED"
    : route === "relayed" ? "RELAYED \u00b7 ENCRYPTED" : "ENCRYPTED";
};

const progressAnnouncer = new ProgressMilestoneAnnouncer();
const wakeLock = new TransferWakeLock();
const tvWakeLock = tvMode ? new TransferWakeLock() : null;
// Progress fires many times a second; only touch the lock on a state change.
let transferActive = false;
const setTransferActive = (active: boolean) => {
  if (active === transferActive) return;
  transferActive = active;
  wakeLock.setActive(active);
};
window.addEventListener("pagehide", () => setTransferActive(false), { once: true });

const showProgress = (name: string, transferred: number, total: number, bytesPerSecond: number) => {
  if (!transferPanel || !transferTitle || !transferDetail || !xferFill) return;
  transferPanel.hidden = false;
  transferTitle.textContent = name;
  const percent = total === 0 ? 100 : Math.min(100, (transferred / total) * 100);
  xferFill.style.width = `${percent}%`;
  xferBar?.setAttribute("aria-valuenow", String(Math.floor(percent)));
  const milestone = progressAnnouncer.update(name, name, percent);
  if (milestone && transferStatus) transferStatus.textContent = milestone;
  setTransferActive(percent < 100);
  transferDetail.textContent = `${formatBytes(transferred)} / ${formatBytes(total)} · ${formatBytes(bytesPerSecond)}/s`;
};

const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
};

const showReceivedText = async (offer: IncomingTransfer, blob: Blob) => {
  if (!receivedPanel || !receivedTitle || !receivedContent) return;
  const text = await blob.text();
  receivedPanel.hidden = false;
  receivedTitle.textContent = offer.kind === "link" ? "Received link" : offer.kind === "clipboard" ? "Received clipboard" : "Received text";
  receivedContent.textContent = text;
  if (receivedOpen) {
    // The text comes from the other device: only offer http(s) links.
    let href: string | null = null;
    if (offer.kind === "link") {
      try {
        const parsed = new URL(text.trim());
        if (parsed.protocol === "https:" || parsed.protocol === "http:") href = parsed.href;
      } catch { /* not a URL: copy-only */ }
    }
    receivedOpen.hidden = href === null;
    if (href) receivedOpen.href = href;
  }
  if (tvMode) receivedCopy?.focus();
};

const requestLabel = (kind: TransferKind): string => {
  if (kind === "file") return "a file";
  if (kind === "link") return "a link";
  if (kind === "clipboard") return "clipboard text";
  return "text";
};

const hideIncomingOffer = (discardTracking = false) => {
  const offer = pendingOffer;
  pendingOffer = null;
  if (discardTracking && offer) {
    transferNames.delete(offer.transferId);
    transferOffers.delete(offer.transferId);
  }
  if (incomingPanel) incomingPanel.hidden = true;
};

const presentIncomingOffer = (offer: IncomingTransfer) => {
  if (isReceivePortal) {
    engine?.reject(offer.transferId, "This page only sends.");
    return;
  }
  if (pendingOffer) {
    engine?.reject(offer.transferId, "Another file is waiting for your decision.");
    return;
  }

  // Something we just asked for arriving is already consented to: skip the
  // "Accept?" prompt for small text-like content. Files still ask, because
  // the receiver chooses where they are saved.
  const answersRequest = outgoingRequestId !== null && outgoingRequestKind === offer.kind
    && offer.kind !== "file" && offer.size <= DEFAULT_MAX_MEMORY_RECEIVE_BYTES;
  if (outgoingRequestId) {
    outgoingRequestId = null;
    outgoingRequestKind = null;
    if (requestPanel) requestPanel.hidden = true;
  }
  transferNames.set(offer.transferId, offer.name);
  transferOffers.set(offer.transferId, offer);
  if (answersRequest) {
    engine?.accept(offer.transferId);
    return;
  }
  // TV display: there is no remote-friendly way to answer a prompt for every
  // file, and pairing with the session secret was the consent. Take whatever
  // the memory sink can hold; anything larger keeps the manual panel below.
  if (shouldAutoAcceptOnTv(tvMode, offer, DEFAULT_MAX_MEMORY_RECEIVE_BYTES)) {
    engine?.accept(offer.transferId);
    if (offer.kind === "file") notify(`Receiving ${offer.name} · ${formatBytes(offer.size)}`);
    return;
  }
  pendingOffer = offer;

  const canReceiveInMemory = offer.size <= DEFAULT_MAX_MEMORY_RECEIVE_BYTES;
  const canStreamToDisk = offer.kind === "file" && FileSystemReceiveSink.isSupported();
  if (incomingPanel && incomingTitle && incomingDetail) {
    incomingPanel.hidden = false;
    incomingTitle.textContent = `Incoming ${offer.kind}`;
    const safetyNote = canReceiveInMemory
      ? ""
      : canStreamToDisk
        ? ` · too large for the ${formatBytes(DEFAULT_MAX_MEMORY_RECEIVE_BYTES)} browser-memory limit; save directly to disk`
        : ` · exceeds the ${formatBytes(DEFAULT_MAX_MEMORY_RECEIVE_BYTES)} safe browser-memory limit`;
    incomingDetail.textContent = `${offer.name} · ${formatBytes(offer.size)}${safetyNote}`;
  }
  if (incomingSave) incomingSave.hidden = !canStreamToDisk;
  if (incomingMemory) {
    incomingMemory.hidden = !canReceiveInMemory;
    incomingMemory.textContent = offer.kind === "file" ? "Receive in browser" : "Accept";
  }
  if (tvMode) {
    // The one case a TV still decides by hand: land the remote's focus on
    // the first available answer.
    const target = [incomingSave, incomingMemory, incomingReject].find(button => button && !button.hidden);
    target?.focus();
  }
};

const sendTextValue = async (value: string, kind: Exclude<TransferKind, "file">) => {
  const transferEngine = engine;
  if (!transferEngine) throw new Error("Not connected yet");
  const label = kind === "link" ? "Link" : kind === "clipboard" ? "Clipboard" : "Text";
  const handle = transferEngine.startTextTransfer(value, kind);
  transferNames.set(handle.transferId, label);
  try {
    await handle.completion;
  } finally {
    transferNames.delete(handle.transferId);
  }
};

const fulfillTextRequest = async (request: IncomingRequest) => {
  const promptLabel = request.kind === "link" ? "Paste the link to send" : request.kind === "clipboard" ? "Paste text to send" : "Enter text to send";
  const value = await openComposer(promptLabel);
  if (value === null) {
    engine?.declineRequest(request.requestId, "Request cancelled");
    return;
  }
  await sendTextValue(value, request.kind as Exclude<TransferKind, "file">);
};

const kindForText = (value: string): "text" | "link" => {
  const trimmed = value.trim();
  if (/\s/.test(trimmed)) return "text";
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? "link" : "text";
  } catch {
    return "text";
  }
};

const sendTextLike = async (kind: "text" | "clipboard") => {
  if (!engine) return;
  let value: string | null = null;
  if (kind === "clipboard" && navigator.clipboard?.readText) {
    try { value = await navigator.clipboard.readText(); } catch { value = null; }
  }
  if (value === null || (kind === "clipboard" && value.length === 0)) {
    value = await openComposer(kind === "clipboard" ? "Paste text to send" : "Text or link to send");
  }
  if (value === null) return;
  await sendTextValue(value, kind === "clipboard" ? "clipboard" : kindForText(value));
  notify("Sent.");
};

const attachTransferEngine = async () => {
  if (!channel || !keyPromise) return;
  if (engine) {
    engine.attachChannel(channel);
    return;
  }
  const key = await keyPromise;
  if (!channel || sessionState !== "connected") return;
  engine = new TransferEngine(channel, key, {
    onIncomingOffer: presentIncomingOffer,
    onIncomingRequest: request => {
      if (pendingRequest) {
        engine?.declineRequest(request.requestId, "Another request is awaiting a decision");
        return;
      }
      pendingRequest = request;
      if (requestPanel && requestTitle && requestDetail && requestFulfill) {
        requestPanel.hidden = false;
        requestTitle.textContent = "Incoming request";
        requestDetail.textContent = `The connected device is asking for ${requestLabel(request.kind)}.`;
        requestFulfill.textContent = request.kind === "file" ? "Choose file" : "Provide";
      }
    },
    onRequestDeclined: (requestId, reason) => {
      if (outgoingRequestId === requestId) {
        outgoingRequestId = null;
        outgoingRequestKind = null;
        if (requestPanel) requestPanel.hidden = true;
      }
      notify(reason ?? "The other device declined your request.");
    },
    onProgress: progress => {
      const inbound = transferOffers.has(progress.transferId);
      if (!inbound && activeQueueProgress) activeQueueProgress(progress);
      showProgress(transferNames.get(progress.transferId) ?? (inbound ? "Incoming transfer" : "Sending transfer"), progress.transferred, progress.total, progress.bytesPerSecond);
    },
    onResumed: (transferId, byteOffset) => {
      if (transferPanel && transferTitle && transferDetail) {
        transferPanel.hidden = false;
        transferTitle.textContent = transferNames.get(transferId) ?? "Transfer";
        transferDetail.textContent = `Connection restored · resuming from ${formatBytes(byteOffset)}`;
      }
    },
    onComplete: (transferId, blob, sinkKind) => {
      const offer = transferOffers.get(transferId);
      const name = transferNames.get(transferId) ?? "bridge-download";
      const total = offer?.size ?? blob.size;
      showProgress(name, total, total, 0);
      if (!offer || offer.kind === "file") {
        if (sinkKind === "memory" && !isReceivePortal) downloadBlob(blob, name);
      } else {
        void showReceivedText(offer, blob);
      }
      if (pendingOffer?.transferId === transferId) hideIncomingOffer();
      transferOffers.delete(transferId);
      transferNames.delete(transferId);
    },
    onError: (transferId, error) => {
      if (transferId && pendingOffer?.transferId === transferId) hideIncomingOffer(true);
      if (transferId) {
        transferOffers.delete(transferId);
        transferNames.delete(transferId);
      }
      setTransferActive(false);
      notify(`Transfer failed: ${error.message}`);
    },
    onCancelled: (transferId, reason) => {
      if (pendingOffer?.transferId === transferId) hideIncomingOffer(true);
      transferOffers.delete(transferId);
      transferNames.delete(transferId);
      setTransferActive(false);
      notify(reason ?? "Transfer cancelled");
    },
    onPeerHello: name => {
      const clean = name.trim().toUpperCase().slice(0, 48);
      if (peerlinePeer && clean) peerlinePeer.textContent = clean;
    }
  });
  engine.announcePresence(displayDeviceName());
};

const enqueueFiles = (files: Iterable<File>) => {
  const list = Array.from(files);
  if (list.length === 0) return;
  if (!engine || sessionState !== "connected") {
    notify("Connect another device before sending files.");
    return;
  }
  queue.enqueue(list);
  if (pendingFileRequest) {
    pendingRequest = null;
    pendingFileRequest = false;
    if (requestPanel) requestPanel.hidden = true;
  }
};

const bridge = new BridgeSession(undefined, {
  onState: setState,
  onRoute: setRoute,
  onChannel: nextChannel => {
    channel = nextChannel;
    void attachTransferEngine().catch(error => setState("error", error instanceof Error ? error.message : "Unable to initialize transfer encryption"));
  },
  onSession: (sessionId, expiresAt) => {
    keyPromise = deriveSessionKey(sessionSecret, sessionId);
    void attachTransferEngine().catch(error => setState("error", error instanceof Error ? error.message : "Unable to initialize transfer encryption"));
    if (code) code.innerHTML = `SESSION <strong>${sessionId.toUpperCase()}</strong>`;
    if (sesscode) { sesscode.textContent = sessionId.toUpperCase(); sesscode.hidden = false; }
    if (stExp) stExp.textContent = `EXPIRES ${new Date(expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toUpperCase()}`;
    if (!isGuest && canvas) {
      if (inviteActions) inviteActions.hidden = false;
      pairingUrl = new URL(window.location.href);
      pairingUrl.search = "";
      pairingUrl.hash = "";
      pairingUrl.searchParams.set("session", sessionId);
      pairingUrl.hash = `key=${sessionSecret}`;
      void QRCode.toCanvas(canvas, pairingUrl.toString(), { width: tvMode ? 560 : 264, margin: 1, color: { dark: "#07101f", light: "#ffffff" } })
        .then(() => {
          // qrcode sets inline px sizes that override the responsive CSS and
          // leave the code off-centre in its frame.
          canvas.style.width = "";
          canvas.style.height = "";
        })
        .catch(error => {
          console.error("Unable to render Bridge pairing QR", error);
          if (noteTitle) { showBlock("note-block"); noteTitle.textContent = "Session ready, but the QR could not be rendered."; }
          if (noteDetail) noteDetail.textContent = "RELOAD OR USE THE RECEIVE LINK AFTER CONNECTING";
        });
    }
  }
});

for (const button of buttons) {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "send") {
      pendingFileRequest = false;
      fileInput?.click();
      return;
    }
    if (action === "send-text" || action === "send-clipboard") {
      const kind = action === "send-clipboard" ? "clipboard" : "text";
      void sendTextLike(kind).catch(error => notify(`Unable to send: ${error instanceof Error ? error.message : "Unknown error"}`));
      return;
    }
    if (action === "request") {
      if (!engine || outgoingRequestId) return;
      void askRequestKind().then(kind => {
        if (!kind || !engine || outgoingRequestId) return;
        outgoingRequestId = engine.request(kind);
        outgoingRequestKind = kind;
        if (requestPanel && requestTitle && requestDetail) {
          requestPanel.hidden = false;
          requestTitle.textContent = "Request sent";
          requestDetail.textContent = `Waiting for ${requestLabel(kind)} from the connected device.`;
        }
      });
      return;
    }
    if (action === "receive" && pairingUrl) {
      const receiveUrl = createReceivePortalUrl(pairingUrl).toString();
      void copyText(receiveUrl, "Receive link copied. It expires with this session.", "Copy this receive link");
    }
  });
}

incomingSave?.addEventListener("click", () => {
  const offer = pendingOffer;
  if (!offer || !engine || offer.kind !== "file") return;
  void (async () => {
    try {
      const sink = await FileSystemReceiveSink.create(offer.name, offer.mime);
      engine?.accept(offer.transferId, sink);
      hideIncomingOffer();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      notify(`Unable to open a save destination: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  })();
});

incomingMemory?.addEventListener("click", () => {
  const offer = pendingOffer;
  if (!offer || !engine) return;
  if (offer.size > DEFAULT_MAX_MEMORY_RECEIVE_BYTES) {
    notify("This transfer is too large to receive safely in browser memory. Save it directly to disk in a supported browser.");
    return;
  }
  engine.accept(offer.transferId);
  hideIncomingOffer();
});

incomingReject?.addEventListener("click", () => {
  const offer = pendingOffer;
  if (!offer || !engine) return;
  engine.reject(offer.transferId, "Recipient declined");
  hideIncomingOffer(true);
});

requestFulfill?.addEventListener("click", () => {
  const request = pendingRequest;
  if (!request) return;
  if (request.kind === "file") {
    pendingFileRequest = true;
    fileInput?.click();
    return;
  }
  if (requestPanel) requestPanel.hidden = true;
  pendingRequest = null;
  void fulfillTextRequest(request).catch(error => notify(`Unable to fulfill request: ${error instanceof Error ? error.message : "Unknown error"}`));
});

requestDecline?.addEventListener("click", () => {
  if (pendingRequest && engine) engine.declineRequest(pendingRequest.requestId, "Request declined");
  pendingRequest = null;
  pendingFileRequest = false;
  if (requestPanel) requestPanel.hidden = true;
});

receivedCopy?.addEventListener("click", () => {
  void copyText(receivedContent?.textContent ?? "", "Copied.", "Copy this text");
});

inviteCopy?.addEventListener("click", () => {
  if (pairingUrl) void copyText(pairingUrl.toString(), "Invite link copied. Open it on the other device.", "Copy this invite link");
});

inviteScan?.addEventListener("click", () => {
  void (async () => {
    let text: string | null;
    try {
      text = await scanQrCode();
    } catch (error) {
      const message = error instanceof ScanError ? error.message : "The camera could not be started.";
      notify(message);
      return;
    }
    if (!text) return; // user cancelled
    const invite = parsePairingUrl(text);
    if (!invite) {
      notify("That QR code is not a Bridge invite.");
      return;
    }
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("session", invite.session);
    url.hash = `key=${invite.secret}`;
    window.location.href = url.toString();
  })();
});

fileInput?.addEventListener("change", () => {
  enqueueFiles(fileInput.files ?? []);
  fileInput.value = "";
});

const setDropActive = (active: boolean) => dropZone?.classList.toggle("is-dragging", active);
dropZone?.addEventListener("click", () => {
  if (sessionState === "connected") fileInput?.click();
});
dropZone?.addEventListener("keydown", event => {
  if (sessionState === "connected" && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    fileInput?.click();
  }
});
dropZone?.addEventListener("dragenter", event => {
  event.preventDefault();
  if (sessionState === "connected") setDropActive(true);
});
dropZone?.addEventListener("dragover", event => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = sessionState === "connected" ? "copy" : "none";
});
dropZone?.addEventListener("dragleave", event => {
  if (event.relatedTarget instanceof Node && dropZone.contains(event.relatedTarget)) return;
  setDropActive(false);
});
dropZone?.addEventListener("drop", event => {
  event.preventDefault();
  setDropActive(false);
  if (sessionState !== "connected" || !event.dataTransfer) return;
  enqueueFiles(filesFromDrop(event.dataTransfer));
});

// Paste or drop anywhere on the page, not just on the drop zone. Without the
// window-level dragover/drop handlers a missed drop navigates the tab away
// to the file, abandoning the session.
const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement);

window.addEventListener("dragover", event => {
  if (event.defaultPrevented) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = sessionState === "connected" ? "copy" : "none";
});
window.addEventListener("drop", event => {
  if (event.defaultPrevented) return;
  event.preventDefault();
  if (sessionState !== "connected" || !event.dataTransfer) return;
  enqueueFiles(filesFromDrop(event.dataTransfer));
});
document.addEventListener("paste", event => {
  if (sessionState !== "connected" || !engine || isEditable(event.target) || !event.clipboardData) return;
  const files = Array.from(event.clipboardData.files);
  if (files.length > 0) {
    event.preventDefault();
    enqueueFiles(files);
    return;
  }
  const text = event.clipboardData.getData("text/plain");
  if (text.trim().length === 0) return;
  event.preventDefault();
  void sendTextValue(text, kindForText(text))
    .then(() => notify("Pasted text sent."))
    .catch(error => notify(`Unable to send: ${error instanceof Error ? error.message : "Unknown error"}`));
});

// settings: device name + relay-only privacy mode
settingsToggle?.addEventListener("click", () => {
  const open = settingsPanel?.hidden ?? false;
  if (settingsPanel) settingsPanel.hidden = !open;
  settingsToggle.setAttribute("aria-expanded", String(open));
  if (open && deviceNameInput) {
    deviceNameInput.value = loadDeviceName();
    deviceNameInput.placeholder = displayDeviceName();
    deviceNameInput.focus();
  }
});
settingsPanel?.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  settingsPanel.hidden = true;
  settingsToggle?.setAttribute("aria-expanded", "false");
  settingsToggle?.focus();
});
// TV display is switched by address, so the toggle just navigates: ?tv=1
// enters (and sticks only on a TV-sized screen), ?tv=0 leaves and clears
// any stored preference. decideTvMode applies the rules on load.
document.querySelector<HTMLButtonElement>("#tv-display-toggle")?.addEventListener("click", () => {
  const url = new URL(window.location.href);
  url.searchParams.set("tv", tvMode ? "0" : "1");
  window.location.replace(url.toString());
});
deviceNameForm?.addEventListener("submit", event => {
  event.preventDefault();
  const saved = saveDeviceName(deviceNameInput?.value ?? "");
  const name = displayDeviceName();
  if (peerlineLocal) peerlineLocal.textContent = name.toUpperCase();
  engine?.announcePresence(name);
  notify(saved ? `Device name saved as ${saved}.` : "Using the automatic device name.");
});
if (relayToggle) relayToggle.checked = isRelayOnlyPreferred();
relayToggle?.addEventListener("change", () => {
  setRelayOnlyPreferred(relayToggle.checked);
  if (relayStatus) {
    relayStatus.textContent = relayToggle.checked
      ? "Saved. Relay-only applies to the next session."
      : "Saved. Direct connections are allowed from the next session.";
  }
  // A guest's pairing link is single-use, so only a host can restart in place.
  if (relayActions) relayActions.hidden = isGuest;
});
relayRestart?.addEventListener("click", () => window.location.reload());

window.addEventListener("beforeunload", () => {
  engine?.close("Page closing");
  bridge.close();
});

void (async () => {
  if (pairingError) {
    setState("error", pairingError);
    return;
  }

  try {
    if (isGuest && joiningSession && joiningSecret) await bridge.join(joiningSession, joiningSecret);
    else await bridge.host(sessionSecret);
  } catch (error) {
    setState("error", error instanceof Error ? error.message : "Unknown signaling error");
  }
})();
