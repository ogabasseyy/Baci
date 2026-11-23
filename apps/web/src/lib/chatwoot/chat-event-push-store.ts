import 'server-only';

import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLazyExpoGetter } from '@/lib/expo-push-lazy-client';
import type { PushDelivery } from '@/lib/expo-push-types';
import { chatEventPushTokenRowsSchema } from '@/schemas/chat-event-push';

const getExpoClient = createLazyExpoGetter(() => process.env.EXPO_ACCESS_TOKEN);

export type ChatEventPushScope = {
  merchantId: string;
  eventKey: string;
  /** One-time claim taken for this event before any push work. */
  claim: string;
};

export type ChatEventPushAction =
  | 'claim'
  | 'tokens'
  | 'tickets'
  | 'deactivate'
  | 'attempt';

/**
 * The proof the database push wrappers recompute. Bound to the action, so a
 * proof for one step cannot be replayed for another. Field order and
 * separators must match `private.chat_event_push_lease` exactly.
 */
export function buildChatEventPushProof(
  secret: string,
  issuedAt: number,
  scope: ChatEventPushScope,
  action: ChatEventPushAction
): string {
  const canonical = [
    'chat-event-push:v1',
    String(issuedAt),
    scope.merchantId,
    scope.eventKey,
    scope.claim,
    action,
  ].join('|');
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

/** Arguments every push wrapper takes: scope plus a fresh proof. */
export function chatEventPushArgs(
  secret: string,
  scope: ChatEventPushScope,
  action: ChatEventPushAction
): Record<string, unknown> {
  const issuedAt = Math.floor(Date.now() / 1000);
  return {
    p_proof: buildChatEventPushProof(secret, issuedAt, scope, action),
    p_issued_at: issuedAt,
    p_merchant_id: scope.merchantId,
    p_event_key: scope.eventKey,
    p_claim: scope.claim,
  };
}

/**
 * Push store for one claimed chat event, backed by the proof-and-claim
 * database wrappers. The store, the app and the eligible users are derived
 * in the database from the claimed event, so none of the ids the delivery
 * core passes in are trusted for scope, and no privileged client is used.
 */
export function createChatEventPushStore(
  client: Pick<SupabaseClient, 'rpc'>,
  secret: string,
  scope: ChatEventPushScope
): PushDelivery {
  // The wrappers answer false when the claim is gone; surface that as an
  // error so the delivery core records the lost write.
  const write = async (
    name: string,
    action: ChatEventPushAction,
    args: Record<string, unknown>
  ) => {
    const { data, error } = await client.rpc(name, {
      ...chatEventPushArgs(secret, scope, action),
      ...args,
    });
    if (error) return { error: { message: 'Chat push store write failed' } };
    if (data === false) {
      return { error: { message: 'Chat push claim is no longer active' } };
    }
    return { error: null };
  };

  return {
    getExpo: getExpoClient,
    fetchMerchantTokens: async () => {
      const { data, error } = await client.rpc(
        'chat_event_push_tokens',
        chatEventPushArgs(secret, scope, 'tokens')
      );
      if (error) {
        return {
          data: null,
          error: { message: 'Chat push tokens unavailable' },
        };
      }
      // Check the shape at the boundary; a malformed answer is reported as
      // the same sanitized read error, never passed on to delivery.
      const rows = chatEventPushTokenRowsSchema.safeParse(data);
      if (!rows.success) {
        return {
          data: null,
          error: { message: 'Chat push tokens unavailable' },
        };
      }
      return { data: rows.data, error: null };
    },
    // This store only ever serves a merchant-app push.
    fetchCustomerTokens: async () => ({ data: [], error: null }),
    deactivateTokens: (reason, tokens) =>
      write('chat_event_deactivate_push_tokens', 'deactivate', {
        p_reason: reason,
        p_tokens: tokens,
      }),
    insertTickets: (rows) =>
      write('chat_event_store_push_tickets', 'tickets', {
        p_tickets: rows.map((row) => ({
          push_token: row.push_token,
          ticket_id: row.ticket_id,
        })),
      }),
    // Only counts and status are sent: the database writes fixed wording, so
    // customer text never reaches the push log.
    insertAttempt: (row) =>
      write('chat_event_record_push_attempt', 'attempt', {
        p_attempt: {
          status: row.status,
          token_count: row.token_count,
          sent_count: row.sent_count,
          failed_count: row.failed_count,
          errors: row.errors,
        },
      }),
  };
}
