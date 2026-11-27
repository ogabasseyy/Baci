import 'server-only';

import { createHmac } from 'node:crypto';
import { createAnonClient } from '@/lib/supabase/anon';
import {
  CHAT_FOLLOW_UP_SWEEP_LIMIT,
  type ChatFollowUpIntakeFailure,
  type DueChatFollowUpReminder,
  dueChatFollowUpReminderListSchema,
  dueChatFollowUpReminderSchema,
} from '@/schemas/chat-follow-up-reminder';
import { CHAT_EVENT_SECRET_PATTERN } from './chat-event-intake';

/**
 * The proof `public.list_due_chat_follow_up_reminders` recomputes. Field order
 * and separators must match the database function exactly. Its label differs
 * from every other chat proof, so none can be replayed as another.
 */
export function buildChatFollowUpListProof(
  secret: string,
  issuedAt: number,
  limit: number
): string {
  const canonical = ['chat-follow-up-list:v1', String(issuedAt), String(limit)];
  return createHmac('sha256', secret).update(canonical.join('|')).digest('hex');
}

/**
 * Follow-up reminders that came due in the last 24 hours and nobody handled
 * yet. Public client, like the other chat intakes: the function is useless
 * without the proof.
 */
export async function listDueChatFollowUpReminders(
  env: NodeJS.ProcessEnv = process.env
): Promise<
  { ok: true; reminders: DueChatFollowUpReminder[] } | ChatFollowUpIntakeFailure
> {
  const secret = env.EKAETTE_CHAT_EVENT_RPC_SECRET?.trim() ?? '';
  if (!CHAT_EVENT_SECRET_PATTERN.test(secret)) {
    return { ok: false, code: 'not_configured' };
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  try {
    const { data, error } = await createAnonClient().rpc(
      'list_due_chat_follow_up_reminders',
      {
        p_proof: buildChatFollowUpListProof(
          secret,
          issuedAt,
          CHAT_FOLLOW_UP_SWEEP_LIMIT
        ),
        p_issued_at: issuedAt,
        p_limit: CHAT_FOLLOW_UP_SWEEP_LIMIT,
      }
    );
    if (error) return { ok: false, code: 'unavailable' };
    const parsed = dueChatFollowUpReminderListSchema.safeParse(data);
    if (!parsed.success) return { ok: false, code: 'unavailable' };
    // Row by row: the batch spans stores, so one unreadable row is skipped.
    const reminders = parsed.data.flatMap((row) => {
      const checked = dueChatFollowUpReminderSchema.safeParse(row);
      return checked.success ? [checked.data] : [];
    });
    const skipped = parsed.data.length - reminders.length;
    if (skipped > 0) {
      console.warn('Chat follow-up reminders could not be read', { skipped });
    }
    return { ok: true, reminders };
  } catch {
    return { ok: false, code: 'unavailable' };
  }
}
