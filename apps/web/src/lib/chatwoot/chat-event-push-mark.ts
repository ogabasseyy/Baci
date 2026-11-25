import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type ChatEventPushScope,
  chatEventPushArgs,
} from './chat-event-push-store';

/**
 * Records, for the claim holder, that a push is about to be handed to the
 * delivery provider. Throws unless the database confirms it, which stops the
 * send: a push must never leave without this record.
 */
export async function markChatEventPushDispatch(
  client: Pick<SupabaseClient, 'rpc'>,
  secret: string,
  scope: ChatEventPushScope
): Promise<void> {
  const { data, error } = await client.rpc(
    'chat_event_mark_push_dispatch',
    chatEventPushArgs(secret, scope, 'dispatch')
  );
  if (error || data !== true) {
    throw new Error('chat push dispatch was not recorded');
  }
}
