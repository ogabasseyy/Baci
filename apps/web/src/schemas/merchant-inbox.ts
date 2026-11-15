import { z } from 'zod';

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
  sender: z
    .object({ type: z.string().nullish(), name: z.string().nullish() })
    .nullish(),
});

export const providerInboxConversationSchema = z.object({
  id: providerId,
  inbox_id: providerId,
  status: z.string(),
  unread_count: z.number().int().nonnegative().nullish(),
  last_activity_at: unixSeconds.nullish(),
  created_at: unixSeconds.nullish(),
  meta: z
    .object({
      sender: z.object({ name: z.string().nullish() }).nullish(),
    })
    .nullish(),
  last_non_activity_message: providerInboxMessageSchema.nullish(),
});

export const providerInboxConversationListSchema = z.object({
  data: z.object({
    meta: z
      .object({ all_count: z.number().int().nonnegative().safe().nullish() })
      .nullish(),
    payload: z.array(z.unknown()).max(200),
  }),
});

export const providerInboxMessageListSchema = z.object({
  payload: z.array(z.unknown()).max(200),
});

export const merchantInboxListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  status: z.enum(['open', 'resolved', 'pending', 'all']).default('all'),
});

export const merchantInboxMessagesQuerySchema = z.object({
  before: z.coerce.number().int().positive().safe().optional(),
});

export const merchantInboxConversationIdSchema = z.coerce
  .number()
  .int()
  .positive()
  .safe();

export type MerchantInboxSender = 'customer' | 'store' | 'assistant' | 'system';

export type MerchantInboxMessage = {
  id: number;
  sender: MerchantInboxSender;
  kind: 'text' | 'product_card' | 'other';
  text: string;
  createdAt: string;
};

export type MerchantInboxConversation = {
  id: number;
  status: 'open' | 'resolved' | 'pending' | 'snoozed';
  unreadCount: number;
  customerName: string;
  lastActivityAt: string | null;
  lastMessage: MerchantInboxMessage | null;
};
