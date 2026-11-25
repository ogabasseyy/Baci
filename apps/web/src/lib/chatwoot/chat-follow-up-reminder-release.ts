import 'server-only';

import { createHmac } from 'node:crypto';
import { createAnonClient } from '@/lib/supabase/anon';
import { CHAT_EVENT_SECRET_PATTERN } from './chat-event-intake';

export type ChatFollowUpReleaseInput = {
  merchantId: string;
  reminderId: string;
};

/**
 * The proof `public.release_chat_follow_up_reminder` recomputes. Field order and
 * separators must match the database function exactly.
 */
export function buildChatFollowUpReleaseProof(
  secret: string,
  issuedAt: number,
  input: ChatFollowUpReleaseInput
): string {
  const canonical = [
    'chat-follow-up-release:v1',
    String(issuedAt),
    input.merchantId,
    input.reminderId,
  ];
  return createHmac('sha256', secret).update(canonical.join('|')).digest('hex');
}

/**
 * Puts back a reminder whose push never left the server, so the next sweep
 * tries again. True only when the database did so; it refuses after three
 * takes or a day past the due time. Call it only for such a failure.
 */
export async function releaseChatFollowUpReminder(
  input: ChatFollowUpReleaseInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const secret = env.EKAETTE_CHAT_EVENT_RPC_SECRET?.trim() ?? '';
  if (!CHAT_EVENT_SECRET_PATTERN.test(secret)) return false;
  const issuedAt = Math.floor(Date.now() / 1000);
  try {
    const { data, error } = await createAnonClient().rpc(
      'release_chat_follow_up_reminder',
      {
        p_proof: buildChatFollowUpReleaseProof(secret, issuedAt, input),
        p_issued_at: issuedAt,
        p_merchant_id: input.merchantId,
        p_reminder_id: input.reminderId,
      }
    );
    return !error && data === true;
  } catch {
    return false;
  }
}
