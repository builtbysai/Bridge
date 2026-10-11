import QRCode from "qrcode";
import { BridgeSession, type BridgeSessionState } from "./bridge-session";
import { deriveSessionKey } from "./crypto";
import type { ConnectionRoute } from "./peer";
import { DEFAULT_MAX_MEMORY_RECEIVE_BYTES, FileSystemReceiveSink } from "./receive-sink";
import { createReceivePortalUrl, isReceivePortalUrl } from "./receive-portal";
import { filesFromDrop, TransferQueue, type TransferQueueSnapshot } from "./transfer-queue";
import { TransferEngine, type IncomingRequest, type IncomingTransfer, type TransferKind, type TransferProgress } from "./transfer";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

const SESSION_PATTERN = /^[a-f0-9]{12}$/i;
const SECRET_PATTERN = /^[a-f0-9]{64}$/i;

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
  ? "This pairing link is incomplete or invalid. Ask the sender for a fresh Bridge link or QR code."
  : null;
const isGuest = !pairingError && Boolean(joiningSession && joiningSecret);
const isReceivePortal = isGuest && isReceivePortalUrl(currentUrl);
const sessionSecret = joiningSecret ?? randomSecret();

const primaryActions = isReceivePortal
  ? `
      <button data-action="send" disabled>Send files</button>
      <button data-action="send-text" disabled>Send text</button>
      <button data-action="send-link" disabled>Send a link</button>
      <button data-action="send-clipboard" disabled>Send clipboard</button>
    `
  : `
      <button data-action="send" disabled>Send files</button>
      <button data-action="request" disabled>Request something</button>
      <button data-action="receive" disabled>Copy receive link</button>
    `;

app.innerHTML = `
  <main class="shell ${isReceivePortal ? "portal-shell" : ""}">
    <header>
      <div class="brand">Bridge</div>
      <div class="pill">alpha</div>
    </header>

    <section class="hero ${isReceivePortal ? "portal-hero" : ""}">
      <p class="eyebrow">${isReceivePortal ? "Guest Receive Portal" : "Temporary device connection"}</p>
      <h1>${isReceivePortal ? "Send something to this device." : "Move something between devices."}</h1>
      <p class="lede">${isReceivePortal ? "Choose what you want to send. It travels over the temporary encrypted peer connection and this portal expires with the session." : "No account. No permanent cloud drive. Pair two browsers, transfer what you need, disconnect."}</p>
    </section>

    <section class="link-diagram" id="link-diagram" data-state="idle" aria-hidden="true">
      <span class="node">This browser</span>
      <span class="tunnel"><i></i></span>
      <span class="node node-peer">Paired device</span>
    </section>

    <section class="pair-card ${isReceivePortal ? "portal-card" : ""}">
      <div class="pair-info">
        <p class="label" id="pair-label">${isReceivePortal ? "Sending to paired device" : isGuest ? "Joining device" : "Connect another device"}</p>
        <div class="qr-wrap" id="qr-wrap" ${isGuest || pairingError ? "hidden" : ""}><canvas id="qr"></canvas></div>
        <p class="code" id="session-code">${pairingError ? "Invalid pairing link" : isGuest ? `Session <strong>${joiningSession?.toUpperCase()}</strong>` : "Creating secure session…"}</p>
        <p class="fine" id="session-detail">${pairingError ? pairingError : isReceivePortal ? "This page can send into the paired session. It does not expose the receiver's dashboard or transfer history." : isGuest ? "Pairing information was read from this link." : "A high-entropy secret will be embedded in the QR fragment and is not sent in the page request."}</p>
      </div>
      <div class="actions ${isReceivePortal ? "portal-actions" : ""}">
        ${primaryActions}
        <input id="file-input" type="file" hidden multiple />
      </div>
    </section>

    <section class="drop-zone" id="drop-zone" tabindex="0" role="button" aria-label="Choose files or drop files here" aria-disabled="true">
      <strong>Drop files here</strong>
      <small>or press Enter to choose files</small>
    </section>

    <section class="queue-panel" id="queue-panel" hidden aria-live="polite">
      <div class="queue-header">
        <div>
          <strong>Transfer queue</strong>
          <small id="queue-summary"></small>
        </div>
        <button id="queue-clear" class="secondary compact" type="button">Clear finished</button>
      </div>
      <div class="queue-list" id="queue-list"></div>
    </section>

    <section class="connection">
      <span class="dot" id="connection-dot"></span>
      <div>
        <strong id="connection-title">Connecting to signaling…</strong>
        <small id="connection-detail">Preparing a secure peer session.</small>
      </div>
      <span class="route-pill" id="route-pill" hidden></span>
    </section>

    <section class="request-panel" id="incoming-panel" hidden aria-live="assertive">
      <div>
        <strong id="incoming-title">Incoming transfer</strong>
        <small id="incoming-detail"></small>
      </div>
      <div class="request-actions">
        <button id="incoming-save">Save to disk</button>
        <button id="incoming-memory" class="secondary">Receive in browser</button>
        <button id="incoming-reject" class="secondary">Decline</button>
      </div>
    </section>

    <section class="request-panel" id="request-panel" hidden aria-live="polite">
      <div>
        <strong id="request-title">Incoming request</strong>
        <small id="request-detail"></small>
      </div>
      <div class="request-actions">
        <button id="request-fulfill">Choose</button>
        <button id="request-decline" class="secondary">Decline</button>
      </div>
    </section>

    <section class="transfer-panel" id="transfer-panel" hidden aria-live="polite">
      <div>
        <strong id="transfer-title">Transfer</strong>
        <small id="transfer-detail"></small>
      </div>
      <progress id="transfer-progress" max="100" value="0"></progress>
    </section>

    <section class="received-panel" id="received-panel" hidden aria-live="polite">
      <strong id="received-title">Received</strong>
      <pre id="received-content"></pre>
      <button id="received-copy">Copy</button>
    </section>
  </main>
`;

const canvas = document.querySelector<HTMLCanvasElement>("#qr");
const code = document.querySelector<HTMLElement>("#session-code");
const detail = document.querySelector<HTMLElement>("#session-detail");
const title = document.querySelector<HTMLElement>("#connection-title");
const connectionDetail = document.querySelector<HTMLElement>("#connection-detail");
const connectionDot = document.querySelector<HTMLElement>("#connection-dot");
const linkDiagram = document.querySelector<HTMLElement>("#link-diagram");
const routePill = document.querySelector<HTMLElement>("#route-pill");
const transferPanel = document.querySelector<HTMLElement>("#transfer-panel");
const transferTitle = document.querySelector<HTMLElement>("#transfer-title");
const transferDetail = document.querySelector<HTMLElement>("#transfer-detail");
const transferProgress = document.querySelector<HTMLProgressElement>("#transfer-progress");
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
const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-action]")];

if (incomingSave && !FileSystemReceiveSink.isSupported()) incomingSave.hidden = true;

let sessionState: BridgeSessionState = "idle";
let channel: RTCDataChannel | null = null;
let engine: TransferEngine | null = null;
let keyPromise: Promise<CryptoKey> | null = null;
let pairingUrl: URL | null = null;
let pendingRequest: IncomingRequest | null = null;
let outgoingRequestId: string | null = null;
let pendingOffer: IncomingTransfer | null = null;
let pendingFileRequest = false;
let activeQueueProgress: ((progress: TransferProgress) => void) | null = null;
const transferNames = new Map<string, string>();
const transferOffers = new Map<string, IncomingTransfer>();

const queue = new TransferQueue(async (file, { signal, onProgress }) => {
  const transferEngine = engine;
  if (!transferEngine || sessionState !== "connected") throw new Error("Peer connection is not ready");
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
    ? `${snapshot.pendingCount} remaining · files send one at a time`
    : "Queue complete";
  queueList.innerHTML = snapshot.items.map(item => {
    const percentage = item.progress.total === 0 ? 100 : Math.min(100, (item.progress.transferred / item.progress.total) * 100);
    const canCancel = item.status === "queued" || item.status === "sending";
    const detailText = item.status === "failed"
      ? item.error ?? "Transfer failed"
      : item.status === "sending"
        ? `${formatBytes(item.progress.transferred)} / ${formatBytes(item.progress.total)} · ${formatBytes(item.progress.bytesPerSecond)}/s`
        : formatBytes(item.file.size);
    return `
      <article class="queue-item" data-queue-id="${item.id}" data-status="${item.status}">
        <div class="queue-item-copy">
          <strong title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</strong>
          <small>${queueStatusLabel(item.status)} · ${escapeHtml(detailText)}</small>
          <progress max="100" value="${percentage}" ${item.status === "queued" ? "hidden" : ""}></progress>
        </div>
        ${canCancel ? `<button class="secondary compact" type="button" data-queue-cancel="${item.id}">${item.status === "sending" ? "Cancel" : "Remove"}</button>` : ""}
      </article>
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

const resetTransferState = (reason: string) => {
  engine?.close(reason);
  engine = null;
  channel = null;
  pendingOffer = null;
  pendingRequest = null;
  outgoingRequestId = null;
  pendingFileRequest = false;
  activeQueueProgress = null;
  transferNames.clear();
  transferOffers.clear();
  if (incomingPanel) incomingPanel.hidden = true;
  if (requestPanel) requestPanel.hidden = true;
};

const setState = (state: BridgeSessionState, message?: string) => {
  const previous = sessionState;
  sessionState = state;
  if ((state === "waiting" && previous === "connected") || state === "closed" || state === "error") {
    resetTransferState(message ?? `Bridge session ${state}`);
  }

  if (!title || !connectionDetail) return;
  const labels: Record<BridgeSessionState, [string, string]> = {
    idle: ["Ready", "Waiting to start."],
    signaling: ["Connecting to signaling…", "Establishing the temporary rendezvous channel."],
    waiting: ["Waiting for another device", "Scan the QR code on the device you want to connect."],
    connecting: ["Device found, connecting", "Negotiating the best WebRTC route."],
    connected: [isReceivePortal ? "Ready to send" : "Device connected", isReceivePortal ? "Choose a file, text, link, or clipboard content to send." : "The encrypted transfer channel is ready."],
    closed: ["Session closed", message ?? "This temporary session has ended."],
    error: ["Connection problem", message ?? "Unable to establish the session."]
  };
  const [heading, subheading] = labels[state];
  title.textContent = heading;
  connectionDetail.textContent = subheading;
  if (connectionDot) connectionDot.dataset.state = state;
  if (linkDiagram) linkDiagram.dataset.state = state;
  for (const button of buttons) button.disabled = state !== "connected";
  if (dropZone) dropZone.setAttribute("aria-disabled", String(state !== "connected"));
};

const setRoute = (route: ConnectionRoute) => {
  if (!routePill) return;
  if (route === "direct") {
    routePill.hidden = false;
    routePill.textContent = "Direct";
  } else if (route === "relayed") {
    routePill.hidden = false;
    routePill.textContent = "Relayed";
  } else {
    routePill.hidden = true;
  }
};

const showProgress = (name: string, transferred: number, total: number, bytesPerSecond: number) => {
  if (!transferPanel || !transferTitle || !transferDetail || !transferProgress) return;
  transferPanel.hidden = false;
  transferTitle.textContent = name;
  transferProgress.value = total === 0 ? 100 : Math.min(100, (transferred / total) * 100);
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
    engine?.reject(offer.transferId, "Receive Portal is send-only");
    return;
  }
  if (pendingOffer) {
    engine?.reject(offer.transferId, "Another incoming transfer is awaiting a decision");
    return;
  }

  pendingOffer = offer;
  transferNames.set(offer.transferId, offer.name);
  transferOffers.set(offer.transferId, offer);
  if (outgoingRequestId) {
    outgoingRequestId = null;
    if (requestPanel) requestPanel.hidden = true;
  }

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
};

const sendTextValue = async (value: string, kind: Exclude<TransferKind, "file">) => {
  const transferEngine = engine;
  if (!transferEngine) throw new Error("Peer connection is not ready");
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
  const promptLabel = request.kind === "link" ? "Paste the link to send" : request.kind === "clipboard" ? "Paste clipboard text to send" : "Enter text to send";
  const value = window.prompt(promptLabel);
  if (value === null) {
    engine?.declineRequest(request.requestId, "Request cancelled");
    return;
  }
  await sendTextValue(value, request.kind as Exclude<TransferKind, "file">);
};

const sendTextLike = async (kind: Exclude<TransferKind, "file">) => {
  if (!engine) return;
  let value: string | null = null;
  if (kind === "clipboard" && navigator.clipboard?.readText) {
    try { value = await navigator.clipboard.readText(); } catch { value = null; }
  }
  if (value === null || (kind === "clipboard" && value.length === 0)) {
    const label = kind === "link" ? "Paste the link to send" : kind === "clipboard" ? "Paste clipboard text to send" : "Enter text to send";
    value = window.prompt(label);
  }
  if (value === null) return;
  await sendTextValue(value, kind);
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
        if (requestPanel) requestPanel.hidden = true;
      }
      window.alert(reason ?? "The other device declined your request.");
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
      window.alert(`Transfer failed: ${error.message}`);
    },
    onCancelled: (transferId, reason) => {
      if (pendingOffer?.transferId === transferId) hideIncomingOffer(true);
      transferOffers.delete(transferId);
      transferNames.delete(transferId);
      window.alert(reason ?? "Transfer cancelled");
    }
  });
};

const enqueueFiles = (files: Iterable<File>) => {
  const list = Array.from(files);
  if (list.length === 0) return;
  if (!engine || sessionState !== "connected") {
    window.alert("Connect another device before sending files.");
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
    if (code) code.innerHTML = `Session <strong>${sessionId.toUpperCase()}</strong>`;
    if (detail && !isReceivePortal) detail.textContent = `Expires ${new Date(expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
    if (!isGuest && canvas) {
      pairingUrl = new URL(window.location.href);
      pairingUrl.search = "";
      pairingUrl.hash = "";
      pairingUrl.searchParams.set("session", sessionId);
      pairingUrl.hash = `key=${sessionSecret}`;
      void QRCode.toCanvas(canvas, pairingUrl.toString(), { width: 210, margin: 1, color: { dark: "#07101f", light: "#f7fbff" } })
        .catch(error => {
          console.error("Unable to render Bridge pairing QR", error);
          if (detail) detail.textContent = "The session is ready, but the pairing QR could not be rendered. Reload or use the Receive Portal link after connecting.";
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
    if (action === "send-text" || action === "send-link" || action === "send-clipboard") {
      const kind = action === "send-link" ? "link" : action === "send-clipboard" ? "clipboard" : "text";
      void sendTextLike(kind).catch(error => window.alert(`Unable to send: ${error instanceof Error ? error.message : "Unknown error"}`));
      return;
    }
    if (action === "request") {
      if (!engine || outgoingRequestId) return;
      const raw = window.prompt("What do you want from the connected device?\n\nEnter: file, text, link, or clipboard", "file")?.trim().toLowerCase();
      if (!raw) return;
      if (!["file", "text", "link", "clipboard"].includes(raw)) {
        window.alert("Choose file, text, link, or clipboard.");
        return;
      }
      outgoingRequestId = engine.request(raw as TransferKind);
      if (requestPanel && requestTitle && requestDetail) {
        requestPanel.hidden = false;
        requestTitle.textContent = "Request sent";
        requestDetail.textContent = `Waiting for ${requestLabel(raw as TransferKind)} from the connected device.`;
      }
      return;
    }
    if (action === "receive" && pairingUrl) {
      const receiveUrl = createReceivePortalUrl(pairingUrl);
      void navigator.clipboard.writeText(receiveUrl.toString())
        .then(() => window.alert("Receive Portal link copied. It expires with this session."))
        .catch(() => window.prompt("Copy this Receive Portal link", receiveUrl.toString()));
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
      window.alert(`Unable to open a save destination: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  })();
});

incomingMemory?.addEventListener("click", () => {
  const offer = pendingOffer;
  if (!offer || !engine) return;
  if (offer.size > DEFAULT_MAX_MEMORY_RECEIVE_BYTES) {
    window.alert("This transfer is too large to receive safely in browser memory. Save it directly to disk in a supported browser.");
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
  void fulfillTextRequest(request).catch(error => window.alert(`Unable to fulfill request: ${error instanceof Error ? error.message : "Unknown error"}`));
});

requestDecline?.addEventListener("click", () => {
  if (pendingRequest && engine) engine.declineRequest(pendingRequest.requestId, "Request declined");
  pendingRequest = null;
  pendingFileRequest = false;
  if (requestPanel) requestPanel.hidden = true;
});

receivedCopy?.addEventListener("click", () => {
  const value = receivedContent?.textContent ?? "";
  void navigator.clipboard.writeText(value).catch(() => undefined);
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
