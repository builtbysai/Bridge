const MILESTONES = [25, 50, 75, 100] as const;

type ProgressState = {
  lastPercentage: number;
  lastMilestone: number;
};

export class ProgressMilestoneAnnouncer {
  private readonly states = new Map<string, ProgressState>();

  update(key: string, label: string, percentage: number): string | null {
    const bounded = Math.max(0, Math.min(100, Math.floor(percentage)));
    const previous = this.states.get(key);
    const reset = previous && bounded < previous.lastPercentage;
    const lastMilestone = reset ? 0 : previous?.lastMilestone ?? 0;
    const reached = [...MILESTONES].reverse().find(milestone => bounded >= milestone) ?? 0;

    this.states.set(key, {
      lastPercentage: bounded,
      lastMilestone: Math.max(lastMilestone, reached)
    });

    if (reached === 0 || reached <= lastMilestone) return null;
    return `${label} transfer ${reached}% complete.`;
  }
}

export const installTransferProgressAnnouncements = (root: ParentNode = document): void => {
  const panel = root.querySelector<HTMLElement>("#transfer-panel");
  const title = root.querySelector<HTMLElement>("#transfer-title");
  const detail = root.querySelector<HTMLElement>("#transfer-detail");
  const progress = root.querySelector<HTMLProgressElement>("#transfer-progress");
  const app = root.querySelector<HTMLElement>("#app");
  if (!panel || !title || !detail || !progress || !app) return;

  const status = document.createElement("div");
  status.id = "transfer-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  Object.assign(status.style, {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: "0",
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: "0"
  });
  app.append(status);

  const announcer = new ProgressMilestoneAnnouncer();
  const announce = () => {
    if (panel.hidden) return;
    const label = title.textContent?.trim() || "Transfer";
    const message = announcer.update(label, label, progress.value);
    if (message) status.textContent = message;
  };

  const observer = new MutationObserver(announce);
  observer.observe(detail, { childList: true, characterData: true, subtree: true });
  observer.observe(title, { childList: true, characterData: true, subtree: true });
};

if (typeof document !== "undefined") installTransferProgressAnnouncements();
