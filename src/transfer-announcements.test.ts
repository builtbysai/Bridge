import { describe, expect, it } from "vitest";
import { ProgressMilestoneAnnouncer } from "./transfer-announcements";

describe("transfer progress announcements", () => {
  it("announces only coarse milestones", () => {
    const announcer = new ProgressMilestoneAnnouncer();

    expect(announcer.update("file-a", "report.zip", 2)).toBeNull();
    expect(announcer.update("file-a", "report.zip", 24)).toBeNull();
    expect(announcer.update("file-a", "report.zip", 25)).toBe("report.zip transfer 25% complete.");
    expect(announcer.update("file-a", "report.zip", 49)).toBeNull();
    expect(announcer.update("file-a", "report.zip", 50)).toBe("report.zip transfer 50% complete.");
    expect(announcer.update("file-a", "report.zip", 79)).toBe("report.zip transfer 75% complete.");
    expect(announcer.update("file-a", "report.zip", 99)).toBeNull();
    expect(announcer.update("file-a", "report.zip", 100)).toBe("report.zip transfer 100% complete.");
    expect(announcer.update("file-a", "report.zip", 100)).toBeNull();
  });

  it("resets when the same visible transfer label starts again", () => {
    const announcer = new ProgressMilestoneAnnouncer();

    expect(announcer.update("same-name", "photo.jpg", 100)).toBe("photo.jpg transfer 100% complete.");
    expect(announcer.update("same-name", "photo.jpg", 10)).toBeNull();
    expect(announcer.update("same-name", "photo.jpg", 30)).toBe("photo.jpg transfer 25% complete.");
  });

  it("announces the highest milestone reached when progress jumps", () => {
    const announcer = new ProgressMilestoneAnnouncer();
    expect(announcer.update("fast", "small.txt", 82)).toBe("small.txt transfer 75% complete.");
    expect(announcer.update("fast", "small.txt", 100)).toBe("small.txt transfer 100% complete.");
  });
});
