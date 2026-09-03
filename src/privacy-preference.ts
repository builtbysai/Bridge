export const RELAY_ONLY_STORAGE_KEY = "bridge.privacy.relayOnly";

export const isRelayOnlyPreferred = (storage: Pick<Storage, "getItem"> = window.localStorage): boolean =>
  storage.getItem(RELAY_ONLY_STORAGE_KEY) === "true";

export const setRelayOnlyPreferred = (
  enabled: boolean,
  storage: Pick<Storage, "setItem"> = window.localStorage
): void => {
  storage.setItem(RELAY_ONLY_STORAGE_KEY, String(enabled));
};
