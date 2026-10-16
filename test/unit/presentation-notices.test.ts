import { describe, expect, it } from "vitest";

import { renderNotificationText } from "../../src/app/presentation/notices.js";

describe("terminal notification formatting", () => {
  const notification = {
    id: "notice-1",
    level: "error",
    scope: "service",
    code: "dispatch.failed",
    message: "The model could not be reached.",
    createdAt: "2026-10-16T00:00:00.000Z"
  } as const;

  it("includes the title, detail, and next action", () => {
    expect(renderNotificationText({
      ...notification,
      title: "Action failed",
      detail: "Connection refused.",
      nextStep: "Run pi-dual doctor."
    })).toBe("Action failed.\nThe model could not be reached.\nConnection refused.\nRun pi-dual doctor.");
  });

  it("does not repeat a title that matches the message", () => {
    expect(renderNotificationText({
      ...notification,
      title: notification.message
    })).toBe(notification.message);
  });

  it("renders a message without an optional title", () => {
    expect(renderNotificationText(notification)).toBe(notification.message);
  });
});
