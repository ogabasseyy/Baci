import type { InboxConversation, InboxView } from '@/schemas/merchant-inbox';

const PRIORITY_RANK = { urgent: 4, high: 3, medium: 2, low: 1 } as const;

const time = (iso: string | null | undefined): number =>
  iso ? Date.parse(iso) || 0 : 0;

const rank = (c: InboxConversation): number =>
  c.priority ? PRIORITY_RANK[c.priority] : 0;

/** A follow-up whose time has come: marked, but no longer snoozed. */
export function isFollowUpDue(c: InboxConversation): boolean {
  return !!c.followUp && c.status !== 'snoozed' && c.status !== 'resolved';
}

/**
 * Most important first. Priority always leads. Then, per view: "Needs reply"
 * puts the chat that has waited longest first; "Follow-up" puts due ones
 * first, then the soonest to come back; the rest stay newest first.
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
  return [...conversations].sort(
    (a, b) => rank(b) - rank(a) || tieBreak(a, b) || a.id - b.id
  );
}
