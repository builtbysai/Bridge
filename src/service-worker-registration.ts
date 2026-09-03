export const registerBridgeServiceWorker = async (
  production = import.meta.env.PROD,
): Promise<ServiceWorkerRegistration | null> => {
  // Vite development serves unhashed /src/* module URLs. Registering the
  // production cache-first worker there can pin stale source modules across
  // reloads and make local/e2e validation exercise old code.
  if (!production || !("serviceWorker" in navigator)) return null;

  try {
    return await navigator.serviceWorker.register("/sw.js", {
      // The worker itself is release control-plane code. Always revalidate it
      // independently of an intermediary HTTP cache when the browser checks
      // for an update.
      updateViaCache: "none",
    });
  } catch (error) {
    console.warn("Bridge service worker registration failed", error);
    return null;
  }
};

if (typeof window !== "undefined" && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void registerBridgeServiceWorker();
  }, { once: true });
}
