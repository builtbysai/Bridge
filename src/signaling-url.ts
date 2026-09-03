export type SignalingLocation = Pick<Location, "protocol" | "hostname">;

const SIGNAL_PATH = "/signal";

const parseOverride = (value: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("VITE_SIGNALING_URL must be an absolute WebSocket URL");
  }

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("VITE_SIGNALING_URL must use ws: or wss:");
  }
  if (url.username || url.password) {
    throw new Error("VITE_SIGNALING_URL must not contain URL credentials");
  }
  if (url.pathname !== SIGNAL_PATH || url.search || url.hash) {
    throw new Error(`VITE_SIGNALING_URL must target the exact ${SIGNAL_PATH} path without query or fragment data`);
  }
  return url;
};

export const signalingUrlForEnvironment = (
  override: string | undefined,
  location: SignalingLocation,
): string => {
  const configured = override?.trim();
  if (configured) {
    const url = parseOverride(configured);
    if (location.protocol === "https:" && url.protocol !== "wss:") {
      throw new Error("HTTPS Bridge deployments require a secure wss: signaling URL");
    }
    return url.toString();
  }

  if (location.protocol === "https:") {
    throw new Error("VITE_SIGNALING_URL is required for HTTPS Bridge deployments");
  }
  if (location.protocol !== "http:" || !location.hostname) {
    throw new Error("Bridge cannot infer a signaling URL for this page location");
  }

  return `ws://${location.hostname}:8787${SIGNAL_PATH}`;
};
