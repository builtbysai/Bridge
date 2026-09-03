const PAIRING_SECRET_PARAMETER = "key";

export const sanitizeConsumedPairingUrl = (href) => {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));

  if (!fragment.has(PAIRING_SECRET_PARAMETER)) return null;

  fragment.delete(PAIRING_SECRET_PARAMETER);
  const remainingFragment = fragment.toString();
  url.hash = remainingFragment ? `#${remainingFragment}` : "";
  return url.href;
};

export const scrubConsumedPairingSecret = (browserWindow = globalThis.window) => {
  if (!browserWindow?.location || !browserWindow?.history?.replaceState) return false;

  const sanitizedUrl = sanitizeConsumedPairingUrl(browserWindow.location.href);
  if (!sanitizedUrl) return false;

  browserWindow.history.replaceState(browserWindow.history.state, "", sanitizedUrl);
  return true;
};
