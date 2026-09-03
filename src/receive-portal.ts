export const RECEIVE_PORTAL_PARAM = "portal";
export const RECEIVE_PORTAL_VALUE = "receive";

export const isReceivePortalUrl = (url: URL): boolean =>
  url.searchParams.get(RECEIVE_PORTAL_PARAM) === RECEIVE_PORTAL_VALUE &&
  Boolean(url.searchParams.get("session")) &&
  Boolean(new URLSearchParams(url.hash.slice(1)).get("key"));

export const createReceivePortalUrl = (pairingUrl: URL): URL => {
  const portalUrl = new URL(pairingUrl.toString());
  portalUrl.searchParams.set(RECEIVE_PORTAL_PARAM, RECEIVE_PORTAL_VALUE);
  return portalUrl;
};
