import 'server-only';

import { createHmac } from 'node:crypto';
import { createAnonClient } from '@/lib/supabase/anon';
import {
  type ChatFollowUpIntakeFailure,
  type ChatFollowUpRecordResult,
  chatFollowUpRecordResultSchema,
} from '@/schemas/chat-follow-up-reminder';
import { CHAT_EVENT_SECRET_PATTERN } from './chat-event-intake';

export type ChatFollowUpRecordInput = {
  merchantId: string;
  reminderId: string;
  /** False consumes a reminder the server found stale, without a push. */
  send: boolean;
};

/**
 * The proof `public.record_chat_follow_up_reminder` recomputes. Field order and
 * separators must match the database function exactly. The send decision is
 * part of it, so an answer of "do not send" cannot be turned into "send".
 */
export function buildChatFollowUpRecordProof(
  secret: string,
  issuedAt: number,
  input: ChatFollowUpRecordInput
): string {
  const canonical = [
    'chat-follow-up:v1',
    String(issuedAt),
    input.merchantId,
    input.reminderId,
    String(input.send),
  ];
  return createHmac('sha256', secret).update(canonical.join('|')).digest('hex');
}

/**
 * Takes one reminder exactly once. `notified` is the only answer that may be
 * pushed (it carries the take number); `muted` and `ignored` (already taken,
 * replaced, not due, or not to be sent) never are.
 */
export async function recordChatFollowUpReminder(
  input: ChatFollowUpRecordInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<
  ({ ok: true } & ChatFollowUpRecordResult) | ChatFollowUpIntakeFailure
> {
  const secret = env.EKAETTE_CHAT_EVENT_RPC_SECRET?.trim() ?? '';
  if (!CHAT_EVENT_SECRET_PATTERN.test(secret)) {
    return { ok: false, code: 'not_configured' };
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  try {
    const { data, error } = await createAnonClient().rpc(
      'record_chat_follow_up_reminder',
      {
        p_proof: buildChatFollowUpRecordProof(secret, issuedAt, input),
        p_issued_at: issuedAt,
        p_merchant_id: input.merchantId,
        p_reminder_id: input.reminderId,
        p_send: input.send,
      }
    );
    if (error) return { ok: false, code: 'unavailable' };
    const parsed = chatFollowUpRecordResultSchema.safeParse(data);
    if (!parsed.success) return { ok: false, code: 'unavailable' };
    return { ok: true, ...parsed.data };
  } catch {
    return { ok: false, code: 'unavailable' };
  }
}
