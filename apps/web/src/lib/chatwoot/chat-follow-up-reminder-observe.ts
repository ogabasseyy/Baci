import 'server-only';

import { getMerchantInboxConversation } from './merchant-inbox-client';
import type { MerchantInboxBinding } from './merchant-inbox-config';

/** What the chat engine shows about a chat's follow-up. */
export type ObservedFollowUp = {
  status: string;
  followUp?: boolean;
  snoozedUntil?: string | null;
};

/** Reads the chat again. `undefined` when the engine could not be read. */
export async function observeChatFollowUp(
  binding: MerchantInboxBinding,
  conversationId: number
): Promise<ObservedFollowUp | undefined> {
  const read = await getMerchantInboxConversation(binding, conversationId);
  if (!read.ok) return undefined;
  const { status, followUp, snoozedUntil } = read.conversation;
  return { status, followUp, snoozedUntil };
}
