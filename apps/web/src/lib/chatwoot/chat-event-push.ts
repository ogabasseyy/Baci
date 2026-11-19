import 'server-only';

import { randomUUID } from 'node:crypto';
import { notifyMerchantWithStore } from '@/lib/expo-push-core';
import { createAnonClient } from '@/lib/supabase/anon';
import {
  chatEventPushArgs,
  createChatEventPushStore,
} from './chat-event-push-store';

const SECRET_PATTERN = /^[\x21-\x7e]{32,256}$/;

export type ChatEventPushInput = {
  merchantId: string;
  eventKey: string;
  conversationId: number;
  customerName: string;
  preview: string;
};

export type ChatEventPushResult =
  | { status: 'sent'; sent: number; failed: number }
  | { status: 'partial'; sent: number; failed: number }
  | {
      status: 'skipped';
      reason: 'not_configured' | 'already_claimed' | 'muted';
    }
  | { status: 'failed' };

/**
 * Pushes a "new customer message" notification to the store's merchant-app
 * devices for one notified chat event, unless the merchant turned chat push
 * alerts off. Best effort and at most once: the
 * database hands out a single claim per event, so a redelivered webhook
 * never pushes twice, and a failed push is not retried here.
 */
export async function sendChatEventPush(
  input: ChatEventPushInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<ChatEventPushResult> {
  const secret = env.EKAETTE_CHAT_EVENT_RPC_SECRET?.trim() ?? '';
  if (!SECRET_PATTERN.test(secret)) {
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
    const result = await notifyMerchantWithStore(
      createChatEventPushStore(client, secret, scope),
      input.merchantId,
      input.customerName
        ? `New message from ${input.customerName}`
        : 'New customer message',
      input.preview || 'A customer sent a message to your store.',
      { type: 'customer_message', conversation_id: input.conversationId },
      'general'
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
