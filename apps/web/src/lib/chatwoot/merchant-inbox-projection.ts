import {
  type MerchantInboxConversation,
  type MerchantInboxMessage,
  type MerchantInboxSender,
  providerInboxConversationSchema,
  providerInboxMessageSchema,
} from '@/schemas/merchant-inbox';
import { INBOX_PRIORITIES } from '@/schemas/merchant-inbox-manage';

import { hasFollowUpLabel, tagsFromLabels } from './merchant-inbox-labels';

const MAX_TEXT_LENGTH = 4_000;
const MAX_NAME_LENGTH = 80;
const INCOMING = 0;
const OUTGOING = 1;
const TEMPLATE = 3;
const STATUSES = new Set(['open', 'resolved', 'pending', 'snoozed']);
const PRIORITIES = new Set<string>(INBOX_PRIORITIES);

function toIso(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number') return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function snoozeToIso(value: number | string | null | undefined): string | null {
  if (typeof value === 'number') return toIso(value);
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Truncates without splitting a surrogate pair at the boundary. */
export function truncateByCodePoint(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const cut = value.slice(0, maxLength);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** Oldest first by creation time; the id only breaks ties. */
export function compareMerchantInboxMessages(
  left: MerchantInboxMessage,
  right: MerchantInboxMessage
): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1;
  }
  return left.id - right.id;
}

function cardTitles(attributes: unknown): string[] {
  if (attributes === null || typeof attributes !== 'object') return [];
  const items = (attributes as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .slice(0, 10)
    .map((item) =>
      item !== null &&
      typeof item === 'object' &&
      typeof (item as { title?: unknown }).title === 'string'
        ? (item as { title: string }).title.trim()
        : ''
    )
    .filter((title) => title.length > 0);
}

/**
 * Projects one provider message to the merchant-safe shape. Returns null for
 * anything a merchant timeline must not show as a customer-visible message:
 * private notes, activity rows, and malformed payloads.
 */
export function projectMerchantInboxMessage(
  raw: unknown
): MerchantInboxMessage | null {
  const parsed = providerInboxMessageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const message = parsed.data;
  if (message.private === true) return null;

  let sender: MerchantInboxSender;
  if (message.message_type === INCOMING) sender = 'customer';
  else if (message.message_type === OUTGOING) {
    sender = message.sender?.type === 'agent_bot' ? 'assistant' : 'store';
  } else if (message.message_type === TEMPLATE) sender = 'system';
  else return null;

  const createdAt = toIso(message.created_at);
  if (!createdAt) return null;

  const content = (message.content ?? '').trim();
  const isCard = message.content_type === 'cards';
  const titles = isCard ? cardTitles(message.content_attributes) : [];
  const text = [content, ...titles].filter(Boolean).join('\n');
  const hasAttachment = (message.attachments?.length ?? 0) > 0;
  const kind = isCard
    ? 'product_card'
    : hasAttachment && !text
      ? 'other'
      : !message.content_type || message.content_type === 'text'
        ? 'text'
        : 'other';
  if (!text && kind !== 'other') return null;

  const followUps = message.content_attributes as
    | { ekaette_follow_ups?: { actions?: unknown } }
    | undefined;
  const actions = followUps?.ekaette_follow_ups?.actions;
  return {
    id: message.id,
    sender,
    kind,
    text: truncateByCodePoint(text, MAX_TEXT_LENGTH),
    createdAt,
    ...(sender === 'assistant' &&
    Array.isArray(actions) &&
    actions.includes('review_checkout') &&
    /name\s+and\s+surname/i.test(text)
      ? { checkoutNameRequested: true as const }
      : {}),
  };
}

/**
 * Projects one provider conversation, and only when it belongs to the bound
 * inbox: the inbox id is the tenant boundary inside a messaging account.
 */
export function projectMerchantInboxConversation(
  raw: unknown,
  inboxId: number
): MerchantInboxConversation | null {
  const parsed = providerInboxConversationSchema.safeParse(raw);
  if (!parsed.success) return null;
  const conversation = parsed.data;
  if (conversation.inbox_id !== inboxId) return null;
  if (!STATUSES.has(conversation.status)) return null;

  const name = conversation.meta?.sender?.name?.trim();
  return {
    id: conversation.id,
    status: conversation.status as MerchantInboxConversation['status'],
    unreadCount: conversation.unread_count ?? 0,
    customerName: truncateByCodePoint(name || 'Customer', MAX_NAME_LENGTH),
    lastActivityAt: toIso(
      conversation.last_activity_at ?? conversation.created_at
    ),
    lastMessage: conversation.last_non_activity_message
      ? projectMerchantInboxMessage(conversation.last_non_activity_message)
      : null,
    tags: tagsFromLabels(conversation.labels ?? []),
    priority:
      conversation.priority && PRIORITIES.has(conversation.priority)
        ? (conversation.priority as (typeof INBOX_PRIORITIES)[number])
        : null,
    followUp: hasFollowUpLabel(conversation.labels ?? []),
    snoozedUntil:
      conversation.status === 'snoozed'
        ? snoozeToIso(conversation.snoozed_until)
        : null,
  };
}
