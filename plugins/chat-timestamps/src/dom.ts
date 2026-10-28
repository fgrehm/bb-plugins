import type { MessageTime } from "./contract";
import { formatExactTime, formatRelativeTime } from "./format";

const TIME_ATTR = "data-bb-chat-timestamp";
const ORIGINAL_TITLE_ATTR = "data-bb-chat-timestamp-original-title";
const MESSAGE_SELECTOR = ".group\\/message";
const HEADER_TITLE_SELECTOR =
  "p.relative.min-w-0.truncate.text-sm.font-normal.transition-colors";
const MAX_VISIBLE_THREADS = 8;

export function threadIdFromPath(
  pathname = window.location.pathname,
): string | null {
  const match = decodeURIComponent(pathname).match(/\/threads\/([^/?#]+)/u);
  return match?.[1] ?? null;
}

export function visibleThreadIds(): string[] {
  const ids = new Set<string>();
  const routeThreadId = threadIdFromPath();
  if (routeThreadId) ids.add(routeThreadId);

  document
    .querySelectorAll<HTMLElement>(
      '[data-sidebar-thread-id][aria-current="page"]',
    )
    .forEach((row) => {
      if (row.dataset.sidebarThreadId) ids.add(row.dataset.sidebarThreadId);
    });

  const idsByTitle = new Map<string, string | null>();
  document
    .querySelectorAll<HTMLElement>("[data-sidebar-thread-id]")
    .forEach((row) => {
      const id = row.dataset.sidebarThreadId;
      const title = row.parentElement
        ?.querySelector<HTMLElement>("span.truncate")
        ?.textContent?.trim();
      if (!id || !title) return;
      const previous = idsByTitle.get(title);
      idsByTitle.set(
        title,
        previous === undefined || previous === id ? id : null,
      );
    });

  document
    .querySelectorAll<HTMLElement>("[data-thread-header-workflow-actions]")
    .forEach((actions) => {
      let scope: HTMLElement | null = actions.parentElement;
      for (let depth = 0; scope && depth < 4; depth += 1) {
        const title = scope
          .querySelector<HTMLElement>(HEADER_TITLE_SELECTOR)
          ?.textContent?.trim();
        const id = title ? idsByTitle.get(title) : null;
        if (id) {
          ids.add(id);
          break;
        }
        scope = scope.parentElement;
      }
    });

  return Array.from(ids).slice(0, MAX_VISIBLE_THREADS);
}

function timestampHost(row: HTMLElement): HTMLElement | null {
  const message = row.querySelector<HTMLElement>(MESSAGE_SELECTOR);
  if (message) {
    return (
      message.querySelector<HTMLElement>(".relative.w-full > .absolute") ??
      message
    );
  }

  return row.querySelector<HTMLElement>(
    ".group\\/timeline-row > button, .group\\/timeline-row > div",
  );
}

function restoreTitle(host: HTMLElement): void {
  const original = host.getAttribute(ORIGINAL_TITLE_ATTR);
  if (original === null) return;
  if (original) host.title = original;
  else host.removeAttribute("title");
  host.removeAttribute(ORIGINAL_TITLE_ATTR);
}

function clearHost(host: HTMLElement): void {
  restoreTitle(host);
  host.removeAttribute(TIME_ATTR);
}

export function decorate(times: ReadonlyMap<string, MessageTime>): void {
  const activeHosts = new Set<HTMLElement>();
  document
    .querySelectorAll<HTMLElement>("[data-timeline-row-id]")
    .forEach((row) => {
      const time = row.dataset.timelineRowId
        ? times.get(row.dataset.timelineRowId)
        : undefined;
      if (!time) return;
      const host = timestampHost(row);
      if (!host) return;
      if (!host.hasAttribute(ORIGINAL_TITLE_ATTR)) {
        host.setAttribute(
          ORIGINAL_TITLE_ATTR,
          host.getAttribute("title") ?? "",
        );
      }
      host.setAttribute(TIME_ATTR, formatRelativeTime(time.createdAt));
      host.title = `${time.direction === "sent" ? "Sent" : "Received"} ${formatExactTime(time.createdAt)}`;
      activeHosts.add(host);
    });

  document.querySelectorAll<HTMLElement>(`[${TIME_ATTR}]`).forEach((host) => {
    if (!activeHosts.has(host)) clearHost(host);
  });
}

export function clearDecorations(): void {
  document.querySelectorAll<HTMLElement>(`[${TIME_ATTR}]`).forEach(clearHost);
}

/** Conversation rows in view whose timestamp has not been loaded yet. */
export function hasUndecoratedMessageRows(
  times: ReadonlyMap<string, MessageTime>,
): boolean {
  for (const row of document.querySelectorAll<HTMLElement>(
    "[data-timeline-row-id]",
  )) {
    const id = row.dataset.timelineRowId;
    if (!id || times.has(id)) continue;
    if (row.querySelector(MESSAGE_SELECTOR)) return true;
  }
  return false;
}
