import { mergeChatLabels } from './chat-auto-reply-labels';

/** Merchant-chosen tags are stored as provider labels with this prefix. */
export const INBOX_TAG_PREFIX = 'tag-';
/** Marks a conversation the merchant wants to come back to. */
export const INBOX_FOLLOW_UP_LABEL = 'follow-up';
/** Tags one conversation may carry, so a chat never turns into a label wall. */
export const INBOX_MAX_TAGS = 5;
const MAX_TAG_LENGTH = 30;
/**
 * What the conversations response allows (see `schemas/merchant-inbox.ts`):
 * one chat with more, or longer, tags would make the whole page fail to parse.
 */
const MAX_PROJECTED_TAGS = 10;

/**
 * The one spelling of a tag: letters, numbers and single hyphens. Spaces,
 * underscores, repeated separators and punctuation all become one hyphen, so
 * "order_issue", "Order issue" and "order--issue" are the same tag instead of
 * look-alikes. Used for what people type and for labels made elsewhere.
 */
function canonicalTag(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/** At most `max` UTF-16 units, never leaving half of a surrogate pair. */
function cutAtUnits(text: string, max: number): string {
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * Turns what a person typed ("Order issue") into a label-safe slug
 * ("order-issue"). Null when nothing usable remains.
 */
export function slugifyInboxTag(name: string): string | null {
  const slug = cutAtUnits(canonicalTag(name), MAX_TAG_LENGTH).replace(
    /-+$/g,
    ''
  );
  return slug.length > 0 ? slug : null;
}

/** Tags are compared in their canonical spelling, whoever made the label. */
const tagKey = canonicalTag;

/**
 * The merchant tags among a conversation's labels, without the prefix. Always
 * fits the response contract: labels with no usable letters or numbers, or
 * longer than a tag can be, are skipped, and only the first ten are kept.
 */
export function tagsFromLabels(labels: readonly string[]): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const label of labels) {
    if (!label.startsWith(INBOX_TAG_PREFIX)) continue;
    const tag = label.slice(INBOX_TAG_PREFIX.length);
    const key = tagKey(tag);
    // Look-alikes ("order-issue" and "Order_Issue") are one tag, shown once.
    if (!key || tag.length > MAX_TAG_LENGTH || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_PROJECTED_TAGS) break;
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
  const tagOf = (label: string) =>
    label.startsWith(INBOX_TAG_PREFIX)
      ? tagKey(label.slice(INBOX_TAG_PREFIX.length))
      : null;
  const removeKeys = new Set((change.removeTags ?? []).map(tagKey));
  const kept = existing.filter((label) => {
    const key = tagOf(label);
    return key === null || !removeKeys.has(key);
  });
  const known = new Set(
    kept.map(tagOf).filter((key): key is string => key !== null)
  );
  const add: string[] = [];
  const room = Math.max(
    0,
    INBOX_MAX_TAGS - kept.filter((l) => l.startsWith(INBOX_TAG_PREFIX)).length
  );
  for (const tag of change.addTags ?? []) {
    const key = tagKey(tag);
    if (!known.has(key) && add.length < room) {
      add.push(`${INBOX_TAG_PREFIX}${tag}`);
      known.add(key);
    }
  }
  return mergeChatLabels(kept, {
    add: [...add, ...(change.followUp === true ? [INBOX_FOLLOW_UP_LABEL] : [])],
    remove: change.followUp === false ? [INBOX_FOLLOW_UP_LABEL] : [],
  });
}
