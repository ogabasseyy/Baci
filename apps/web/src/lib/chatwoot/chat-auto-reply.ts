import 'server-only';

import { generateChatAutoReply } from '@/ai/chat-auto-reply';
import {
  CHAT_AUTO_REPLY_MIN_CONFIDENCE,
  type ChatAutoReply,
} from '@/schemas/chat-auto-reply';
import type { ChatWebhookMessageCreated } from '@/schemas/chat-webhook';
import {
  postAssistantMessage,
  setConversationLabels,
  setConversationStatus,
} from './chat-auto-reply-client';
import type { ChatAutoReplyBinding } from './chat-auto-reply-config';
import {
  decideChatAutoReply,
  isMerchantReply,
} from './chat-auto-reply-decision';
import { loadChatAutoReplyHistory } from './chat-auto-reply-history';
import {
  CHAT_LABEL_AI,
  CHAT_LABEL_MERCHANT,
  CHAT_LABEL_NEEDS_HUMAN,
  mergeChatLabels,
} from './chat-auto-reply-labels';

const HANDOVER_MESSAGE =
  "Thanks for your message. I'm passing this to our team, and someone will reply here shortly.";

export type ChatAutoReplyOutcome =
  | 'replied'
  | 'handed_over'
  | 'skipped'
  | 'failed';

type Conversation = { conversationId: number; labels: readonly string[] };

function labelsOf(event: ChatWebhookMessageCreated): Conversation {
  return {
    conversationId: event.conversation.id,
    labels: event.conversation.labels ?? [],
  };
}

async function handOver(
  binding: ChatAutoReplyBinding,
  conversation: Conversation,
  reason: string
): Promise<ChatAutoReplyOutcome> {
  // The customer is told first: if a later step fails they still know a
  // person is coming. The status change is what actually stops the assistant.
  const told = await postAssistantMessage(binding, {
    conversationId: conversation.conversationId,
    content: HANDOVER_MESSAGE,
  });
  const opened = await setConversationStatus(binding, {
    conversationId: conversation.conversationId,
    status: 'open',
  });
  await postAssistantMessage(binding, {
    conversationId: conversation.conversationId,
    content: `Assistant handed this over: ${reason}.`,
    isPrivate: true,
  });
  await setConversationLabels(binding, {
    conversationId: conversation.conversationId,
    labels: mergeChatLabels(conversation.labels, {
      add: [CHAT_LABEL_NEEDS_HUMAN],
    }),
  });
  return told && opened ? 'handed_over' : 'failed';
}

function needsHandover(draft: ChatAutoReply): string | null {
  if (draft.needsHuman) return 'the question needs a person';
  if (draft.confidence < CHAT_AUTO_REPLY_MIN_CONFIDENCE) {
    return 'the assistant was not confident enough';
  }
  return null;
}

/**
 * Answers one customer message as the store's assistant, or hands the
 * conversation to a person. Never throws: the webhook has already been
 * acknowledged, so a failure here only means the customer waits for a person.
 */
export async function runChatAutoReply(
  binding: ChatAutoReplyBinding,
  event: ChatWebhookMessageCreated
): Promise<ChatAutoReplyOutcome> {
  const decision = decideChatAutoReply(event);
  if (decision.action === 'skip') return 'skipped';
  const conversation = labelsOf(event);
  if (decision.action === 'handover') {
    return handOver(binding, conversation, 'the customer asked for a person');
  }

  const question = (event.content ?? '').trim();
  const history = await loadChatAutoReplyHistory(
    binding,
    conversation.conversationId,
    event.id
  );
  const result = await generateChatAutoReply({
    merchantId: binding.merchantId,
    conversationId: conversation.conversationId,
    question,
    history,
  });
  if (!result.ok) {
    return handOver(binding, conversation, 'the assistant was unavailable');
  }
  const reason = needsHandover(result.reply);
  if (reason) return handOver(binding, conversation, reason);

  const sent = await postAssistantMessage(binding, {
    conversationId: conversation.conversationId,
    content: result.reply.reply,
  });
  if (!sent) return 'failed';
  await setConversationLabels(binding, {
    conversationId: conversation.conversationId,
    labels: mergeChatLabels(conversation.labels, {
      add: [CHAT_LABEL_AI],
      remove: [CHAT_LABEL_NEEDS_HUMAN],
    }),
  });
  return 'replied';
}

/**
 * A staff reply takes the conversation over: it moves to the person's queue
 * (so the assistant stops) and the "handled by" label switches to merchant.
 */
export async function recordMerchantTakeover(
  binding: ChatAutoReplyBinding,
  event: ChatWebhookMessageCreated
): Promise<ChatAutoReplyOutcome> {
  if (!isMerchantReply(event)) return 'skipped';
  const conversation = labelsOf(event);
  if (event.conversation.status === 'pending') {
    await setConversationStatus(binding, {
      conversationId: conversation.conversationId,
      status: 'open',
    });
  }
  const done = await setConversationLabels(binding, {
    conversationId: conversation.conversationId,
    labels: mergeChatLabels(conversation.labels, {
      add: [CHAT_LABEL_MERCHANT],
      remove: [CHAT_LABEL_AI, CHAT_LABEL_NEEDS_HUMAN],
    }),
  });
  return done ? 'replied' : 'failed';
}
