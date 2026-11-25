import type { InboxConversation, InboxView } from '@/schemas/merchant-inbox';

const PRIORITY_RANK = { urgent: 4, high: 3, medium: 2, low: 1 } as const;

const time = (iso: string | null | undefined): number =>
  iso ? Date.parse(iso) || 0 : 0;

const rank = (c: InboxConversation): number =>
  c.priority ? PRIORITY_RANK[c.priority] : 0;

/** A signed-in customer who has bought before. */
export const isReturningCustomer = (c: InboxConversation): boolean =>
  !c.customer?.ordersHidden && (c.customer?.orderCount ?? 0) > 0;

/**
 * A follow-up whose time has come: marked, and either back from its snooze or
 * past the snooze time while the chat engine has yet to reopen it.
 */
export function isFollowUpDue(
  c: InboxConversation,
  now: Date = new Date()
): boolean {
  if (!c.followUp || c.status === 'resolved') return false;
  if (c.status !== 'snoozed') return true;
  const until = time(c.snoozedUntil);
  return until > 0 && until <= now.getTime();
}

/**
 * Most important first. Priority always leads, then returning customers
 * (people who have already bought), then, per view: "Needs reply"
 * puts the chat that has waited longest first; "Follow-up" puts due ones
 * first, then the soonest to come back; Done and All stay newest first (their
 * pages are not ranked across, see below).
 */
export function sortInbox(
  conversations: readonly InboxConversation[],
  view: InboxView
): InboxConversation[] {
  const newestFirst = (a: InboxConversation, b: InboxConversation) =>
    time(b.lastActivityAt) - time(a.lastActivityAt);
  const tieBreak = (a: InboxConversation, b: InboxConversation): number => {
    if (view === 'needs_reply') {
      return (
        time(a.lastMessage?.createdAt ?? a.lastActivityAt) -
        time(b.lastMessage?.createdAt ?? b.lastActivityAt)
      );
    }
    if (view === 'follow_up') {
      const due = Number(isFollowUpDue(b)) - Number(isFollowUpDue(a));
      if (due !== 0) return due;
      const soon =
        (time(a.snoozedUntil) || Number.MAX_SAFE_INTEGER) -
        (time(b.snoozedUntil) || Number.MAX_SAFE_INTEGER);
      if (soon !== 0) return soon;
    }
    return newestFirst(a, b);
  };
  // Done and All do not load several pages up front, so a priority ranking
  // would only be true for the page on screen: they stay newest first, which is
  // the order the chat engine pages in and so is right across pages.
  if (view === 'done' || view === 'all') {
    return [...conversations].sort((a, b) => newestFirst(a, b) || a.id - b.id);
  }
  return [...conversations].sort(
    (a, b) =>
      rank(b) - rank(a) ||
      Number(isReturningCustomer(b)) - Number(isReturningCustomer(a)) ||
      tieBreak(a, b) ||
      a.id - b.id
  );
}
