import 'server-only';

import { createHash, createHmac } from 'node:crypto';
import { createAnonClient } from '@/lib/supabase/anon';
import {
  type ChatEventIntakeOutcome,
  chatEventIntakeResultSchema,
} from '@/schemas/chat-webhook';

export const CHAT_EVENT_NAME_MAX_LENGTH = 80;
export const CHAT_EVENT_PREVIEW_MAX_LENGTH = 280;
export const CHAT_EVENT_SECRET_PATTERN = /^[\x21-\x7e]{32,256}$/;

export type ChatCustomerMessageEvent = {
  merchantId: string;
  /** Stable per provider message, so a redelivery is recognised. */
  eventKey: string;
  conversationId: number;
  customerName: string;
  preview: string;
};

export type ChatEventIntakeResult =
  | { ok: true; outcome: ChatEventIntakeOutcome; duplicate: boolean }
  | { ok: false; code: 'not_configured' | 'unavailable' };

/** Cuts at a length without leaving half of a surrogate pair. */
function cap(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const cut = value.slice(0, maxLength);
  const last = cut.charCodeAt(cut.length - 1);
  return (last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut).trim();
}

/** One line, bounded: the only customer text that leaves the webhook. */
export function normalizeChatEventText(
  value: string | null | undefined,
  maxLength: number
): string {
  return cap((value ?? '').replace(/\s+/g, ' ').trim(), maxLength);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * The proof the database function recomputes. Field order and separators
 * must match `public.record_chat_customer_message` exactly.
 */
export function buildChatEventProof(
  secret: string,
  issuedAt: number,
  event: ChatCustomerMessageEvent
): string {
  const canonical = [
    'chat-customer-message:v1',
    String(issuedAt),
    event.merchantId,
    event.eventKey,
    String(event.conversationId),
    sha256Hex(event.customerName),
    sha256Hex(event.preview),
  ].join('|');
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

/**
 * Hands one customer message to the database, which decides whether the
 * merchant is notified. Uses the public client: the function is useless
 * without the server-only proof, so no privileged database client is needed.
 */
export async function recordChatCustomerMessage(
  event: ChatCustomerMessageEvent,
  env: NodeJS.ProcessEnv = process.env
): Promise<ChatEventIntakeResult> {
  const secret = env.EKAETTE_CHAT_EVENT_RPC_SECRET?.trim() ?? '';
  if (!CHAT_EVENT_SECRET_PATTERN.test(secret))
    return { ok: false, code: 'not_configured' };

  const issuedAt = Math.floor(Date.now() / 1000);
  try {
    const { data, error } = await createAnonClient().rpc(
      'record_chat_customer_message',
      {
        p_proof: buildChatEventProof(secret, issuedAt, event),
        p_issued_at: issuedAt,
        p_merchant_id: event.merchantId,
        p_event_key: event.eventKey,
        p_conversation_id: event.conversationId,
        p_customer_name: event.customerName,
        p_preview: event.preview,
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
