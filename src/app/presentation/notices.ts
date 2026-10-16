import type { UiNotification } from "../../types/ui.js";

export function renderNotificationText(notification: UiNotification): string {
  const lines = [
    notification.message,
    notification.detail,
    notification.nextStep
  ];
  if (notification.title && notification.title !== notification.message) {
    lines.unshift(/[.!?]$/.test(notification.title)
      ? notification.title
      : `${notification.title}.`);
  }
  return lines.filter(Boolean).join("\n");
}
