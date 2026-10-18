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
