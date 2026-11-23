import {
  merchantInboxCustomerBadgeSchema,
  merchantInboxCustomerProfileSchema,
} from '@baci/shared';
import { z } from 'zod';

/**
 * Mirrors the web inbox API responses (`apps/web/src/schemas/merchant-inbox.ts`).
 * Only fields the app reads are validated; extra fields are ignored.
 */
export const inboxMessageSchema = z.object({
  id: z.number().int().positive(),
  sender: z.enum(['customer', 'store', 'assistant', 'system']),
  kind: z.enum(['text', 'product_card', 'other']),
  text: z.string(),
  createdAt: z.string(),
});

export const inboxConversationSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(['open', 'resolved', 'pending', 'snoozed']),
  unreadCount: z.number().int().nonnegative(),
  customerName: z.string(),
  lastActivityAt: z.string().nullable(),
  lastMessage: inboxMessageSchema.nullable(),
  // Added by the business tools; older servers omit them.
  tags: z.array(z.string()).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).nullable().optional(),
  followUp: z.boolean().optional(),
  snoozedUntil: z.string().nullable().optional(),
  // A verified signed-in customer of this store, when the chat is linked.
  customer: merchantInboxCustomerBadgeSchema.nullable().optional(),
});

export const inboxConversationsResponseSchema = z.object({
  conversations: z.array(inboxConversationSchema),
  hasMore: z.boolean(),
  page: z.number().int().positive(),
});

export const inboxThreadResponseSchema = z.object({
  conversation: inboxConversationSchema,
  messages: z.array(inboxMessageSchema),
  hasOlder: z.boolean().optional(),
  nextBefore: z.number().int().positive().nullish(),
});

export const inboxReplyResponseSchema = z.object({
  message: inboxMessageSchema,
});

export const inboxUpdateResponseSchema = z.object({
  conversation: inboxConversationSchema,
});

export const inboxSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      conversation: inboxConversationSchema,
      snippet: z.string().nullable(),
    })
  ),
  hasMore: z.boolean(),
  page: z.number().int().positive(),
});

// The same definition the server answers with, from the shared package.
export const inboxCustomerProfileSchema = merchantInboxCustomerProfileSchema;

export const inboxCustomerResponseSchema = z.object({
  customer: inboxCustomerProfileSchema.nullable(),
});

export const INBOX_REPLY_MAX_LENGTH = 2_000;

export type InboxMessage = z.infer<typeof inboxMessageSchema>;
export type InboxConversation = z.infer<typeof inboxConversationSchema>;
export type InboxConversationsPage = z.infer<
  typeof inboxConversationsResponseSchema
>;
export type InboxThreadPage = z.infer<typeof inboxThreadResponseSchema>;
export type InboxSearchResponse = z.infer<typeof inboxSearchResponseSchema>;
export type InboxCustomerProfile = z.infer<typeof inboxCustomerProfileSchema>;
export type InboxPriority = NonNullable<InboxConversation['priority']>;

/** The smart views, in the order the chips show them. */
export const INBOX_VIEWS = [
  { value: 'needs_reply', label: 'Needs reply' },
  { value: 'unread', label: 'Unread' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'returning', label: 'Customers' },
  { value: 'done', label: 'Done' },
  { value: 'all', label: 'All' },
] as const;
export type InboxView = (typeof INBOX_VIEWS)[number]['value'];

/** One change to a chat; mirrors the web PATCH body. */
export type InboxUpdate = {
  status?: 'open' | 'resolved';
  followUpAt?: string | null;
  priority?: InboxPriority | null;
  addTags?: string[];
  removeTags?: string[];
};

/** Quick tags offered first; people can still type their own. */
export const INBOX_PRESET_TAGS = [
  'Order issue',
  'Payment',
  'Delivery',
  'Price',
  'Lead',
] as const;
