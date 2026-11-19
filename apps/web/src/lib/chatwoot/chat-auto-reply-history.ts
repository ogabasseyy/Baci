import 'server-only';

import type { ChatAutoReplyTurn } from '@/ai/chat-auto-reply-prompt';
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
    .filter((message) => message.id !== currentMessageId && message.text.trim())
    .slice(-MAX_TURNS)
    .map((message) => ({
      role: message.sender === 'customer' ? 'user' : 'assistant',
      content: message.text,
    }));
}
