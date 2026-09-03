const labelTransferProgress = () => {
  const progress = document.querySelector("#transfer-progress");
  if (!(progress instanceof HTMLProgressElement)) return;

  progress.setAttribute("aria-labelledby", "transfer-title");
  progress.setAttribute("aria-describedby", "transfer-detail");
};

const labelQueueProgress = (root = document) => {
  for (const progress of root.querySelectorAll(".queue-item progress")) {
    if (!(progress instanceof HTMLProgressElement)) continue;
    const item = progress.closest(".queue-item");
    const name = item?.querySelector(".queue-item-copy > strong")?.textContent?.trim();
    if (!name) continue;
    progress.setAttribute("aria-label", `${name} transfer progress`);
  }
};

const installProgressAccessibility = () => {
  labelTransferProgress();
  labelQueueProgress();

  const queueList = document.querySelector("#queue-list");
  if (!queueList) return;

  const observer = new MutationObserver(() => labelQueueProgress(queueList));
  observer.observe(queueList, { childList: true, subtree: true });
};

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", installProgressAccessibility, { once: true });
} else {
  installProgressAccessibility();
}
