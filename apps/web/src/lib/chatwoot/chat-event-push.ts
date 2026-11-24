import 'server-only';

import { randomUUID } from 'node:crypto';
import { CHAT_REPLY_NOTIFICATION_CATEGORY } from '@baci/shared';
import { notifyMerchantWithStore } from '@/lib/expo-push-core';
import { createAnonClient } from '@/lib/supabase/anon';
import { CHAT_EVENT_SECRET_PATTERN } from './chat-event-intake';
import {
  chatEventPushArgs,
  createChatEventPushStore,
} from './chat-event-push-store';

export type ChatEventPushInput = {
  merchantId: string;
  eventKey: string;
  conversationId: number;
  customerName: string;
  preview: string;
  /** An assistant handover is worded and marked differently. Default: message. */
  kind?: 'message' | 'handover';
};

export type ChatEventPushResult =
  | { status: 'sent'; sent: number; failed: number }
  | { status: 'partial'; sent: number; failed: number }
  | {
      status: 'skipped';
      reason: 'not_configured' | 'already_claimed' | 'muted';
    }
  | { status: 'failed' };

const HANDOVER_PUSH_BODY =
  'The assistant handed this chat to your team. Open it to reply.';

/** Fixed wording per kind; only the bounded customer name and preview vary. */
function pushContent(input: ChatEventPushInput) {
  if (input.kind === 'handover') {
    return {
      title: input.customerName
        ? `${input.customerName} needs a person`
        : 'A customer needs a person',
      body: HANDOVER_PUSH_BODY,
      data: {
        type: 'customer_message',
        conversation_id: input.conversationId,
        merchant_id: input.merchantId,
        handover: true,
      },
    };
  }
  return {
    title: input.customerName
      ? `New message from ${input.customerName}`
      : 'New customer message',
    body: input.preview || 'A customer sent a message to your store.',
    data: {
      type: 'customer_message',
      conversation_id: input.conversationId,
      merchant_id: input.merchantId,
    },
  };
}

/**
 * Pushes a "new customer message" (or, for an assistant handover, "needs a
 * person") notification to the store's merchant-app
 * devices for one notified chat event, unless the merchant turned chat push
 * alerts off. Best effort and at most once: the
 * database hands out a single claim per event, so a redelivered webhook
 * never pushes twice, and a failed push is not retried here.
 *
 * Contract: call this only for an event the database just recorded as
 * `notified` (and not as a duplicate). The alert level is applied there: an
 * ordinary message is not recorded as notified at "handover only", and a
 * handover is notified at "all" and "handover only". The gate below honours
 * "off" only, so it must never be the sole thing deciding whether an
 * ordinary message pushes.
 */
export async function sendChatEventPush(
  input: ChatEventPushInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<ChatEventPushResult> {
  const secret = env.EKAETTE_CHAT_EVENT_RPC_SECRET?.trim() ?? '';
  if (!CHAT_EVENT_SECRET_PATTERN.test(secret)) {
    return { status: 'skipped', reason: 'not_configured' };
  }
  const scope = {
    merchantId: input.merchantId,
    eventKey: input.eventKey,
    claim: randomUUID(),
  };
  try {
    const client = createAnonClient();
    // The merchant can mute chat pushes. An unreadable switch is treated as
    // on, so a store never silently misses customer messages.
    const preference = await client.rpc('get_chat_message_push_preference', {
      p_merchant_id: input.merchantId,
    });
    if (!preference.error && preference.data === false) {
      return { status: 'skipped', reason: 'muted' };
    }
    const claimed = await client.rpc(
      'chat_event_claim_push',
      chatEventPushArgs(secret, scope, 'claim')
    );
    if (claimed.error) return { status: 'failed' };
    if (claimed.data !== true) {
      return { status: 'skipped', reason: 'already_claimed' };
    }
    const content = pushContent(input);
    const result = await notifyMerchantWithStore(
      createChatEventPushStore(client, secret, scope),
      input.merchantId,
      content.title,
      content.body,
      content.data,
      // A chat push is a person waiting: its own high-importance channel (the
      // general one is silent on Android) and a Reply box on the notification.
      'messages',
      { categoryId: CHAT_REPLY_NOTIFICATION_CATEGORY }
    );
    // The delivery layer reports provider failures as counts and errors
    // instead of throwing, so the status has to be derived from them.
    const failed = Math.max(result.failed, result.errors.length > 0 ? 1 : 0);
    if (failed > 0) {
      return result.sent > 0
        ? { status: 'partial', sent: result.sent, failed }
        : { status: 'failed' };
    }
    return { status: 'sent', sent: result.sent, failed: 0 };
  } catch {
    return { status: 'failed' };
  }
}
