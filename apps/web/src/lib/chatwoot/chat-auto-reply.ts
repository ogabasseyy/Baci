import 'server-only';

import { generateChatAutoReply } from '@/ai/chat-auto-reply';
import {
  CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH,
  CHAT_AUTO_REPLY_MIN_CONFIDENCE,
  type ChatAutoReply,
} from '@/schemas/chat-auto-reply';
import type { ChatWebhookMessageCreated } from '@/schemas/chat-webhook';
import {
  getConversationSnapshot,
  postAssistantMessage,
  setConversationLabels,
  setConversationStatus,
} from './chat-auto-reply-client';
import type { ChatAutoReplyBinding } from './chat-auto-reply-config';
import {
  decideChatAutoReply,
  isMerchantReply,
} from './chat-auto-reply-decision';
import {
  isLatestChatMessage,
  loadChatAutoReplyHistory,
} from './chat-auto-reply-history';
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

const HISTORY_DEADLINE_MS = 6_000;

/** Labels are merged against the live list, never the webhook's old copy. */
async function updateLabels(
  binding: ChatAutoReplyBinding,
  conversationId: number,
  change: { add?: readonly string[]; remove?: readonly string[] },
  options: { onlyIfAssistantOwns?: boolean } = {}
): Promise<boolean> {
  const live = await getConversationSnapshot(binding, conversationId);
  // The provider replaces the whole list, so without a live read a write
  // could silently drop someone else's label: skip it instead.
  if (!live) return false;
  // A person who took over meanwhile (their reply moved it out of pending)
  // keeps the conversation and its label.
  if (options.onlyIfAssistantOwns && live.status !== 'pending') return true;
  return setConversationLabels(binding, {
    conversationId,
    labels: mergeChatLabels(live.labels, change),
  });
}

/** True only while the conversation is still the assistant's (pending). */
async function isStillPending(
  binding: ChatAutoReplyBinding,
  conversationId: number
): Promise<boolean> {
  const live = await getConversationSnapshot(binding, conversationId);
  return live?.status === 'pending';
}

async function handOver(
  binding: ChatAutoReplyBinding,
  conversationId: number,
  reason: string
): Promise<ChatAutoReplyOutcome> {
  if (!(await isStillPending(binding, conversationId))) return 'skipped';
  // The status move comes first: it is what stops the assistant. If it fails
  // the customer is not told anything, so the next message simply tries again
  // instead of promising a person who was never notified.
  const opened = await setConversationStatus(binding, {
    conversationId,
    status: 'open',
  });
  if (!opened) return 'failed';
  await postAssistantMessage(binding, {
    conversationId,
    content: HANDOVER_MESSAGE,
  });
  await postAssistantMessage(binding, {
    conversationId,
    content: `Assistant handed this over: ${reason}.`,
    isPrivate: true,
  });
  await updateLabels(binding, conversationId, {
    add: [CHAT_LABEL_NEEDS_HUMAN],
    remove: [CHAT_LABEL_AI],
  });
  return 'handed_over';
}

async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
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
  const conversationId = event.conversation.id;
  if (decision.action === 'handover') {
    return handOver(
      binding,
      conversationId,
      decision.reason === 'customer_sent_attachment'
        ? 'the customer sent an attachment the assistant cannot read'
        : 'the customer asked for a person'
    );
  }

  const question = (event.content ?? '')
    .trim()
    .slice(0, CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH);
  const history = await withDeadline(
    loadChatAutoReplyHistory(binding, conversationId, event.id),
    HISTORY_DEADLINE_MS,
    []
  );
  const result = await generateChatAutoReply({
    merchantId: binding.merchantId,
    conversationId,
    question,
    history,
  });
  if (!result.ok) {
    return handOver(binding, conversationId, 'the assistant was unavailable');
  }
  const reason = needsHandover(result.reply);
  if (reason) return handOver(binding, conversationId, reason);

  // Generation can take a while: a person may have replied, or a later
  // message may have asked for one, since the webhook arrived.
  if (!(await isStillPending(binding, conversationId))) return 'skipped';
  if (!(await isLatestChatMessage(binding, conversationId, event.id))) {
    return 'skipped';
  }
  const sent = await postAssistantMessage(binding, {
    conversationId,
    content: result.reply.reply,
  });
  // A rejected reply (an expired bot credential, say) must not leave the
  // customer pending with nobody queued: a person takes it from here.
  if (!sent) {
    return handOver(binding, conversationId, 'the reply could not be sent');
  }
  await updateLabels(
    binding,
    conversationId,
    {
      add: [CHAT_LABEL_AI],
      remove: [CHAT_LABEL_NEEDS_HUMAN, CHAT_LABEL_MERCHANT],
    },
    { onlyIfAssistantOwns: true }
  );
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
  const conversationId = event.conversation.id;
  // The status move is what stops the assistant: if it fails the takeover
  // is not complete, even when the label lands. The webhook's status can be
  // old by now (a delayed or repeated delivery), so the live one decides:
  // a conversation staff have since resolved or snoozed is left as it is.
  let moved = true;
  if (event.conversation.status === 'pending') {
    const live = await getConversationSnapshot(binding, conversationId);
    if (!live) moved = false;
    else if (live.status === 'pending') {
      moved = await setConversationStatus(binding, {
        conversationId,
        status: 'open',
      });
    }
  }
  const done = await updateLabels(binding, conversationId, {
    add: [CHAT_LABEL_MERCHANT],
    remove: [CHAT_LABEL_AI, CHAT_LABEL_NEEDS_HUMAN],
  });
  return done && moved ? 'replied' : 'failed';
}
