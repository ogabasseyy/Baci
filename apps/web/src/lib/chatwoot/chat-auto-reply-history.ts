import 'server-only';

import type { ChatAutoReplyTurn } from '@/ai/chat-auto-reply-prompt';
import { CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH } from '@/schemas/chat-auto-reply';
import type { ChatAutoReplyBinding } from './chat-auto-reply-config';
import { listMerchantInboxMessages } from './merchant-inbox-client';

const MAX_TURNS = 8;

/**
 * The recent exchange, oldest first, without the message being answered.
 * Best effort: when it cannot be read the assistant answers from the single
 * message, and low confidence hands over to a person.
 */
export async function loadChatAutoReplyHistory(
  binding: ChatAutoReplyBinding,
  conversationId: number,
  currentMessageId: number
): Promise<ChatAutoReplyTurn[]> {
  const result = await listMerchantInboxMessages(binding, { conversationId });
  if (!result.ok) return [];
  return result.messages
    .filter(
      (message) =>
        message.id !== currentMessageId &&
        message.text.trim() &&
        // A person's reply is not the assistant's: showing it as an
        // assistant turn would let the model imitate staff wording.
        (message.sender === 'customer' || message.sender === 'assistant')
    )
    .slice(-MAX_TURNS)
    .map((message) => ({
      role: message.sender === 'customer' ? 'user' : 'assistant',
      content: message.text.slice(0, CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH),
    }));
}

/**
 * True only when no customer or assistant message has arrived after the one
 * being answered. A customer who writes again while the model works gets one
 * answer, from the newer message's own run, in the right order. Other
 * outgoing messages (an automation or campaign post, a system notice) do not
 * count: their webhooks start no assistant run, so treating them as newer
 * would leave the customer with no answer. A person's reply is caught
 * separately, by the conversation leaving `pending`. Unreadable counts as not
 * latest: staying quiet is safer than answering out of turn.
 */
export async function isLatestChatMessage(
  binding: ChatAutoReplyBinding,
  conversationId: number,
  messageId: number
): Promise<boolean> {
  const result = await listMerchantInboxMessages(binding, { conversationId });
  if (!result.ok) return false;
  const latestTurn = result.messages.findLast(
    (message) => message.sender === 'customer' || message.sender === 'assistant'
  );
  return latestTurn?.id === messageId;
}
