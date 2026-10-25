import type { KeyboardEvent } from "react";

/** Horizontal tab lists: one tab stop, arrow/Home/End navigation. */
export function navigateTab(event: KeyboardEvent<HTMLButtonElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]',
    ) ?? [],
  );
  const current = tabs.indexOf(event.currentTarget);
  if (current < 0 || !tabs.length) return;
  event.preventDefault();
  const target =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
          tabs.length;
  tabs[target].focus();
  tabs[target].click();
}
