import { CHAT_REPLY_MAX_LENGTH } from '@baci/shared';
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

export const INBOX_REPLY_MAX_LENGTH = CHAT_REPLY_MAX_LENGTH;

export type InboxMessage = z.infer<typeof inboxMessageSchema>;
export type InboxConversation = z.infer<typeof inboxConversationSchema>;
export type InboxConversationsPage = z.infer<
  typeof inboxConversationsResponseSchema
>;
export type InboxThreadPage = z.infer<typeof inboxThreadResponseSchema>;
