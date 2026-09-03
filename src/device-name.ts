const STORAGE_KEY = "bridge.device-name";
const MAX_DEVICE_NAME_LENGTH = 48;

export const normalizeDeviceName = (value: string): string => value
  .replace(/[\u0000-\u001f\u007f]/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, MAX_DEVICE_NAME_LENGTH);

export const defaultDeviceName = (userAgent = navigator.userAgent): string => {
  if (/iPhone/i.test(userAgent)) return "This iPhone";
  if (/iPad/i.test(userAgent)) return "This iPad";
  if (/Android/i.test(userAgent) && /Mobile/i.test(userAgent)) return "This Android phone";
  if (/Android/i.test(userAgent)) return "This Android device";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "This Mac";
  if (/Windows/i.test(userAgent)) return "This Windows PC";
  if (/Linux/i.test(userAgent)) return "This Linux device";
  return "This device";
};

export const loadDeviceName = (storage: Pick<Storage, "getItem"> = localStorage): string => {
  try {
    return normalizeDeviceName(storage.getItem(STORAGE_KEY) ?? "");
  } catch {
    return "";
  }
};

export const saveDeviceName = (value: string, storage: Pick<Storage, "setItem" | "removeItem"> = localStorage): string => {
  const normalized = normalizeDeviceName(value);
  try {
    if (normalized) storage.setItem(STORAGE_KEY, normalized);
    else storage.removeItem(STORAGE_KEY);
  } catch {
    // Naming is a convenience feature; blocked storage must not prevent transfers.
  }
  return normalized;
};

export const displayDeviceName = (
  storage: Pick<Storage, "getItem"> = localStorage,
  userAgent = navigator.userAgent
): string => loadDeviceName(storage) || defaultDeviceName(userAgent);

export { MAX_DEVICE_NAME_LENGTH };
