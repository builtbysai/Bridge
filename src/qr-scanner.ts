import jsQR from "jsqr";

export const SESSION_PATTERN = /^[a-f0-9]{12}$/i;
export const SECRET_PATTERN = /^[a-f0-9]{64}$/i;

export interface PairingInvite {
  session: string;
  secret: string;
}

// A scanned Bridge invite is the pairing URL the host's QR encodes:
//   https://host/Bridge/?session=<12 hex>#key=<64 hex>
// Returns null for anything else (wrong QR, photo of a QR, etc.).
export function parsePairingUrl(text: string): PairingInvite | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const session = url.searchParams.get("session");
  const secret = new URLSearchParams(url.hash.slice(1)).get("key");
  if (!session || !SESSION_PATTERN.test(session)) return null;
  if (!secret || !SECRET_PATTERN.test(secret)) return null;
  return { session: session.toLowerCase(), secret: secret.toLowerCase() };
}

export type ScanErrorKind = "unsupported" | "denied" | "missing" | "unavailable";

export class ScanError extends Error {
  constructor(
    readonly kind: ScanErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ScanError";
  }
}

// Opens the camera in a full-screen overlay and resolves with the first QR
// payload decoded, or null if the user cancels. Rejects with ScanError when
// the camera cannot be used.
export function scanQrCode(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      reject(new ScanError("unsupported", "This browser cannot open the camera."));
      return;
    }

    const overlay = document.createElement("div");
    overlay.className = "scan-overlay";
    overlay.innerHTML = `
      <video class="scan-video" playsinline muted></video>
      <div class="scan-frame" aria-hidden="true"></div>
      <p class="scan-hint">Point at the Bridge QR code</p>
      <p class="scan-error" id="scan-error" role="alert" hidden></p>
      <button type="button" class="scan-cancel">Cancel</button>
    `;
    const video = overlay.querySelector<HTMLVideoElement>(".scan-video")!;
    const errorEl = overlay.querySelector<HTMLElement>("#scan-error")!;
    const cancelBtn = overlay.querySelector<HTMLButtonElement>(".scan-cancel")!;
    document.body.appendChild(overlay);

    const capture = document.createElement("canvas");
    const captureCtx = capture.getContext("2d", { willReadFrequently: true });

    let stream: MediaStream | null = null;
    let raf = 0;
    let settled = false;

    const cleanup = () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      overlay.remove();
    };
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (kind: ScanErrorKind, message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ScanError(kind, message));
    };

    cancelBtn.addEventListener("click", () => done(null));
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") done(null);
    });

    const tick = () => {
      if (settled || !captureCtx || video.readyState < 2) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const w = video.videoWidth, h = video.videoHeight;
      if (w === 0 || h === 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      // Decode at half resolution: plenty for QR, much cheaper per frame.
      const scale = Math.min(1, 480 / Math.max(w, h));
      capture.width = Math.floor(w * scale);
      capture.height = Math.floor(h * scale);
      captureCtx.drawImage(video, 0, 0, capture.width, capture.height);
      try {
        const image = captureCtx.getImageData(0, 0, capture.width, capture.height);
        const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
        if (code?.data) {
          done(code.data);
          return;
        }
      } catch (error) {
        console.debug("Bridge QR scan frame failed", error);
      }
      raf = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        if (settled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        video.srcObject = s;
        return video.play();
      })
      .then(() => {
        if (!settled) {
          cancelBtn.focus();
          raf = requestAnimationFrame(tick);
        }
      })
      .catch((error: unknown) => {
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          errorEl.textContent = "Camera access was denied. Allow it in your browser settings to scan.";
          errorEl.hidden = false;
          // Keep the overlay open so the user can read it, then cancel.
          return;
        }
        if (name === "NotFoundError" || name === "OverconstrainedError") {
          fail("missing", "No camera found on this device.");
          return;
        }
        fail("unavailable", "The camera could not be started.");
      });
  });
}
