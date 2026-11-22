import { mergeChatLabels } from './chat-auto-reply-labels';

/** Merchant-chosen tags are stored as provider labels with this prefix. */
export const INBOX_TAG_PREFIX = 'tag-';
/** Marks a conversation the merchant wants to come back to. */
export const INBOX_FOLLOW_UP_LABEL = 'follow-up';
/** Tags one conversation may carry, so a chat never turns into a label wall. */
export const INBOX_MAX_TAGS = 5;
const MAX_TAG_LENGTH = 30;

/**
 * Turns what a person typed ("Order issue") into a label-safe slug
 * ("order-issue"): letters, numbers, hyphen and underscore only. Null when
 * nothing usable remains.
 */
export function slugifyInboxTag(name: string): string | null {
  const slug = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, MAX_TAG_LENGTH)
    .replace(/[-_]+$/g, '');
  return slug.length > 0 ? slug : null;
}

/** The merchant tags among a conversation's labels, without the prefix. */
export function tagsFromLabels(labels: readonly string[]): string[] {
  const tags: string[] = [];
  for (const label of labels) {
    if (!label.startsWith(INBOX_TAG_PREFIX)) continue;
    const tag = label.slice(INBOX_TAG_PREFIX.length);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

export function hasFollowUpLabel(labels: readonly string[]): boolean {
  return labels.includes(INBOX_FOLLOW_UP_LABEL);
}

export type InboxLabelChange = {
  addTags?: readonly string[];
  removeTags?: readonly string[];
  followUp?: boolean;
};

/**
 * The full label list after a change. System labels (handled-by-*, needs-human)
 * are never touched. Tags beyond the per-conversation limit are dropped, the
 * oldest kept first, so one request cannot exceed it.
 */
export function applyInboxLabelChange(
  existing: readonly string[],
  change: InboxLabelChange
): string[] {
  const remove = (change.removeTags ?? []).map(
    (tag) => `${INBOX_TAG_PREFIX}${tag}`
  );
  const add: string[] = [];
  const kept = existing.filter((label) => !remove.includes(label));
  const room = Math.max(
    0,
    INBOX_MAX_TAGS - kept.filter((l) => l.startsWith(INBOX_TAG_PREFIX)).length
  );
  for (const tag of change.addTags ?? []) {
    const label = `${INBOX_TAG_PREFIX}${tag}`;
    if (!kept.includes(label) && !add.includes(label) && add.length < room) {
      add.push(label);
    }
  }
  return mergeChatLabels(kept, {
    add: [...add, ...(change.followUp === true ? [INBOX_FOLLOW_UP_LABEL] : [])],
    remove: change.followUp === false ? [INBOX_FOLLOW_UP_LABEL] : [],
  });
}
