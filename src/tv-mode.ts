// TV display mode: Bridge as a living-room receiver. The TV opens this mode
// once and stays a passive endpoint: it shows the pairing QR at reading
// distance, holds the screen awake, and accepts incoming transfers from the
// paired device without a per-file prompt, because a remote has no cheap way
// to answer one. Pairing itself is unchanged — nothing auto-accepts until a
// device has joined with the session secret, and anything too large for the
// in-memory receive limit still falls back to the manual decision panel.

export const TV_MODE_STORAGE_KEY = "bridge.display.tvMode";

export const isTvModePreferred = (storage: Pick<Storage, "getItem"> = window.localStorage): boolean =>
  storage.getItem(TV_MODE_STORAGE_KEY) === "true";

export const setTvModePreferred = (
  enabled: boolean,
  storage: Pick<Storage, "setItem"> = window.localStorage
): void => {
  storage.setItem(TV_MODE_STORAGE_KEY, String(enabled));
};

// The URL wins over the stored preference so a TV can be put into (or taken
// out of) display mode with one address: ?tv=1 enables, ?tv=0 disables.
export const resolveTvMode = (params: URLSearchParams, stored: boolean): boolean => {
  const explicit = params.get("tv");
  if (explicit === "1" || explicit === "true") return true;
  if (explicit === "0" || explicit === "false") return false;
  return stored;
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
