// TV display mode: Bridge as a living-room receiver. The TV opens this mode
// once and stays a passive endpoint: it shows the pairing QR at reading
// distance, holds the screen awake, and accepts incoming transfers from the
// paired device without a per-file prompt, because a remote has no cheap way
// to answer one. Pairing itself is unchanged: nothing auto-accepts until a
// device has joined with the session secret, and anything too large for the
// in-memory receive limit still falls back to the manual decision panel.
//
// The mode is sticky only on a TV-sized screen. A phone that opens a TV link
// once (to check it, or because the link was shared) gets display mode for
// that visit and nothing more; a stored preference found on a small screen
// is ignored and cleared, so no browser is trapped in the couch layout.

export const TV_MODE_STORAGE_KEY = "bridge.display.tvMode";

export const isTvModePreferred = (storage: Pick<Storage, "getItem"> = window.localStorage): boolean =>
  storage.getItem(TV_MODE_STORAGE_KEY) === "true";

export const setTvModePreferred = (
  enabled: boolean,
  storage: Pick<Storage, "setItem"> = window.localStorage
): void => {
  storage.setItem(TV_MODE_STORAGE_KEY, String(enabled));
};

// A TV-sized viewport: wide AND tall. A phone in landscape is wide but
// short (roughly 915x412 CSS px), which keeps it on the visiting-only path;
// TV browsers report 1920x1080, or 960x540 when scaled.
export const isTvSizedViewport = (width: number, height: number): boolean =>
  width >= 900 && height >= 500;

// The URL wins over the stored preference so a TV can be put into (or taken
// out of) display mode with one address: ?tv=1 enables, ?tv=0 disables.
export const resolveTvMode = (params: URLSearchParams, stored: boolean): boolean => {
  const explicit = params.get("tv");
  if (explicit === "1" || explicit === "true") return true;
  if (explicit === "0" || explicit === "false") return false;
  return stored;
};

export interface TvModeDecision {
  enabled: boolean;
  // Storage write to apply, or null to leave the stored preference as is.
  persist: boolean | null;
}

// One decision for page load: whether display mode is on, and whether the
// stored preference changes. Enabling from the URL persists only on a
// TV-sized screen; disabling from the URL always clears; a stored "on"
// found on a small screen is a leftover from a shared link, so it is
// ignored and cleared.
export const decideTvMode = (params: URLSearchParams, stored: boolean, tvSized: boolean): TvModeDecision => {
  const explicit = params.get("tv");
  if (explicit === "0" || explicit === "false") return { enabled: false, persist: false };
  if (explicit === "1" || explicit === "true") return { enabled: true, persist: tvSized ? true : null };
  if (stored && !tvSized) return { enabled: false, persist: false };
  return { enabled: stored, persist: null };
};

export interface AutoAcceptCandidate {
  kind: string;
  size: number;
}

// Auto-accept only what the memory sink could take anyway. A larger file on
// a TV browser has no save-picker flow worth having, so it keeps the manual
// panel (with its too-large explanation) instead of silently failing.
export const shouldAutoAcceptOnTv = (
  tvMode: boolean,
  offer: AutoAcceptCandidate,
  memoryLimitBytes: number
): boolean =>
  tvMode &&
  Number.isSafeInteger(offer.size) &&
  offer.size >= 0 &&
  offer.size <= memoryLimitBytes;
