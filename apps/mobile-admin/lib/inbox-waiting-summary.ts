/**
 * The line above the Needs reply list. With pages still behind, more chats may
 * or may not be waiting (any non-empty page reports more), so it only claims
 * what has been loaded.
 */
export function inboxWaitingSummary(
  count: number,
  hasMore: boolean
): string | null {
  if (count === 0) return null;
  const chats = count === 1 ? '1 chat is' : `${count} chats are`;
  return `${hasMore ? 'At least ' : ''}${chats} waiting for your reply`;
}
