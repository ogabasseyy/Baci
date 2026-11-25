import { z } from 'zod';
import { INBOX_PRIORITIES } from './merchant-inbox-manage';

const providerId = z.number().int().positive().safe();
const unixSeconds = z.number().int().nonnegative().safe();

/** Provider payloads: only the fields the Baci inbox reads are validated. */
export const providerInboxMessageSchema = z.object({
  id: providerId,
  content: z.string().nullish(),
  message_type: z.number().int(),
  private: z.boolean().nullish(),
  created_at: unixSeconds,
  content_type: z.string().nullish(),
  content_attributes: z.unknown().optional(),
  // Presence only: the inbox never reads attachment URLs or metadata.
  attachments: z.array(z.unknown()).max(50).nullish(),
  sender: z
    .object({ type: z.string().nullish(), name: z.string().nullish() })
    .nullish(),
});

export const providerInboxConversationSchema = z.object({
  id: providerId,
  inbox_id: providerId,
  status: z.string(),
  unread_count: z.number().int().nonnegative().nullish(),
  labels: z.array(z.string()).max(100).nullish(),
  priority: z.string().nullish(),
  // Seconds or an ISO string, depending on the provider build.
  snoozed_until: z.union([unixSeconds, z.string()]).nullish(),
  last_activity_at: unixSeconds.nullish(),
  created_at: unixSeconds.nullish(),
  meta: z
    .object({
      sender: z.object({ name: z.string().nullish() }).nullish(),
    })
    .nullish(),
  last_non_activity_message: providerInboxMessageSchema.nullish(),
});

/**
 * Most conversations one page can hold. The provider schema and Baci's own
 * browser response share this limit so they cannot drift apart.
 */
export const MERCHANT_INBOX_MAX_CONVERSATIONS_PER_PAGE = 200;

export const providerInboxConversationListSchema = z.object({
  data: z.object({
    meta: z
      .object({ all_count: z.number().int().nonnegative().safe().nullish() })
      .nullish(),
    payload: z
      .array(z.unknown())
      .max(MERCHANT_INBOX_MAX_CONVERSATIONS_PER_PAGE),
  }),
});

/** `POST /conversations/filter`: the list's rows, without its `data` wrapper. */
export const providerInboxFilteredListSchema = z.object({
  payload: z.array(z.unknown()).max(MERCHANT_INBOX_MAX_CONVERSATIONS_PER_PAGE),
});

export const providerInboxMessageListSchema = z.object({
  payload: z.array(z.unknown()).max(200),
});

export const merchantInboxListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  status: z
    .enum(['open', 'resolved', 'pending', 'snoozed', 'all'])
    .default('all'),
  /** A smart view; when present it decides the status filter itself. */
  view: z
    .enum(['all', 'needs_reply', 'unread', 'follow_up', 'done'])
    .optional(),
});

export const merchantInboxMessagesQuerySchema = z.object({
  before: z.coerce.number().int().positive().safe().optional(),
});

export const merchantInboxConversationIdSchema = z.coerce
  .number()
  .int()
  .positive()
  .safe();

export const MERCHANT_INBOX_REPLY_MAX_LENGTH = 2_000;

export const merchantInboxReplySchema = z.strictObject({
  content: z.string().trim().min(1).max(MERCHANT_INBOX_REPLY_MAX_LENGTH),
});

export type MerchantInboxSender = 'customer' | 'store' | 'assistant' | 'system';

export type MerchantInboxMessage = {
  id: number;
  sender: MerchantInboxSender;
  kind: 'text' | 'product_card' | 'other';
  text: string;
  createdAt: string;
  checkoutNameRequested?: true;
};

export type MerchantInboxConversation = {
  id: number;
  status: 'open' | 'resolved' | 'pending' | 'snoozed';
  unreadCount: number;
  customerName: string;
  lastActivityAt: string | null;
  lastMessage: MerchantInboxMessage | null;
  /** Merchant tags (slugs). Optional so older fixtures and clients still type-check. */
  tags?: string[];
  priority?: (typeof INBOX_PRIORITIES)[number] | null;
  /** Marked "follow up": snoozed, or reopened and due. */
  followUp?: boolean;
  snoozedUntil?: string | null;
};

/** Baci's own inbox responses, validated again in the browser. */
export const merchantInboxMessageSchema = z.object({
  id: providerId,
  sender: z.enum(['customer', 'store', 'assistant', 'system']),
  kind: z.enum(['text', 'product_card', 'other']),
  text: z.string().max(4_000),
  createdAt: z.string().min(1).max(40),
}) satisfies z.ZodType<MerchantInboxMessage>;

export const merchantInboxConversationSchema = z.object({
  id: providerId,
  status: z.enum(['open', 'resolved', 'pending', 'snoozed']),
  unreadCount: z.number().int().nonnegative(),
  customerName: z.string().min(1).max(80),
  lastActivityAt: z.string().min(1).max(40).nullable(),
  lastMessage: merchantInboxMessageSchema.nullable(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  priority: z.enum(INBOX_PRIORITIES).nullable().optional(),
  followUp: z.boolean().optional(),
  snoozedUntil: z.string().min(1).max(40).nullable().optional(),
}) satisfies z.ZodType<MerchantInboxConversation>;

export const merchantInboxConversationsResponseSchema = z.object({
  conversations: z
    .array(merchantInboxConversationSchema)
    .max(MERCHANT_INBOX_MAX_CONVERSATIONS_PER_PAGE),
  hasMore: z.boolean(),
  page: z.number().int().positive(),
});

export const merchantInboxThreadResponseSchema = z.object({
  conversation: merchantInboxConversationSchema,
  messages: z.array(merchantInboxMessageSchema).max(200),
});

export const merchantInboxReplyResponseSchema = z.object({
  message: merchantInboxMessageSchema,
});

/** The code of an error response from Baci's inbox API. */
export const merchantInboxErrorPayloadSchema = z.object({ code: z.string() });
