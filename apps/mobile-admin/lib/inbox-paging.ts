/**
 * The most chat pages loaded without being asked for. The Messages list and the
 * Home count share it, so both see the same chats.
 */
export const MAX_AUTO_PAGES = 5;

const POLL_MS = 30_000;

/**
 * How long to wait before asking again. A refresh asks for every loaded page,
 * so the wait grows with them. A one-page store loads two (its chats and the
 * empty page that ends them) and stays on 30 seconds.
 */
export function inboxRefetchInterval(pages: number): number {
  return POLL_MS * Math.max(1, pages - 1);
}
