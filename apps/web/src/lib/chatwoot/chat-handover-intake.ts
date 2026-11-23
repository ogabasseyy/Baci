import 'server-only';

import { createHmac } from 'node:crypto';
import { createAnonClient } from '@/lib/supabase/anon';
import { chatEventIntakeResultSchema } from '@/schemas/chat-webhook';
import {
  CHAT_EVENT_NAME_MAX_LENGTH,
  CHAT_EVENT_SECRET_PATTERN,
  type ChatEventIntakeResult,
  normalizeChatEventText,
  sha256Hex,
} from './chat-event-intake';

export type ChatHandoverEvent = {
  merchantId: string;
  /** Stable per handover, so a repeat of the same handover is recognised. */
  eventKey: string;
  conversationId: number;
  customerName: string;
};

/**
 * The proof the database function recomputes. Field order and separators
 * must match `public.record_chat_handover` exactly. The label differs from
 * the customer-message proof, so one kind of proof can never be replayed as
 * the other.
 */
export function buildChatHandoverProof(
  secret: string,
  issuedAt: number,
  event: ChatHandoverEvent
): string {
  const canonical = [
    'chat-handover:v1',
    String(issuedAt),
    event.merchantId,
    event.eventKey,
    String(event.conversationId),
    sha256Hex(event.customerName),
  ].join('|');
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

/**
 * Hands one assistant handover to the database, which decides whether the
 * merchant is alerted: yes at the "all" and "handover only" levels, no only
 * when the merchant turned chat alerts off. Public client, like the
 * customer-message intake: the function is useless without the proof.
 */
export async function recordChatHandover(
  event: ChatHandoverEvent,
  env: NodeJS.ProcessEnv = process.env
): Promise<ChatEventIntakeResult> {
  const secret = env.EKAETTE_CHAT_EVENT_RPC_SECRET?.trim() ?? '';
  if (!CHAT_EVENT_SECRET_PATTERN.test(secret)) {
    return { ok: false, code: 'not_configured' };
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  // Sign and send one and the same normalized name: the database hashes the
  // trimmed name it receives, so odd whitespace must never split the two.
  const signed = {
    ...event,
    customerName: normalizeChatEventText(
      event.customerName,
      CHAT_EVENT_NAME_MAX_LENGTH
    ),
  };
  try {
    const { data, error } = await createAnonClient().rpc(
      'record_chat_handover',
      {
        p_proof: buildChatHandoverProof(secret, issuedAt, signed),
        p_issued_at: issuedAt,
        p_merchant_id: signed.merchantId,
        p_event_key: signed.eventKey,
        p_conversation_id: signed.conversationId,
        p_customer_name: signed.customerName,
      }
    );
    if (error) return { ok: false, code: 'unavailable' };
    const parsed = chatEventIntakeResultSchema.safeParse(data);
    if (!parsed.success) return { ok: false, code: 'unavailable' };
    return {
      ok: true,
      outcome: parsed.data.outcome,
      duplicate: parsed.data.duplicate === true,
    };
  } catch {
    return { ok: false, code: 'unavailable' };
  }
}
