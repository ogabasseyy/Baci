import 'server-only';

import type { ChatAutoReplyTurn } from '@/ai/chat-auto-reply-prompt';
import { verifySantaAnswer } from '@/ai/chat-santa-offers';
import { generateTextWithChain } from '@/ai/generate-text-with-chain';
import { sanitizePromptInput } from '@/ai/provider';
import {
  generateSantaPrompt,
  SANTA_CATALOG_TIMEOUT_MS,
} from '@/ai/santa-system-instruction';
import { logSantaInteraction } from '@/app/api/chat/santa/santa-analytics';
import type { AgenticChatTenant } from '@/lib/agentic/agentic-chat-tenant';
import {
  CHAT_AUTO_REPLY_MAX_LENGTH,
  CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH,
} from '@/schemas/chat-auto-reply';
import type { ChatSantaOffer } from '@/schemas/chat-santa-offer';

const WISH_TIMEOUT_MS = 15_000;

/**
 * Answers a Santa wish as Santa. Prices Santa grants are verified by the
 * store before they can reach the customer. Analytics is best-effort.
 */
export async function answerSantaWish(input: {
  tenant: AgenticChatTenant;
  conversationId: number;
  question: string;
  history: readonly ChatAutoReplyTurn[];
}): Promise<{ reply: string; offers: ChatSantaOffer[] }> {
  const clean = (text: string) =>
    sanitizePromptInput(text, CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH).value;
  const system = await generateSantaPrompt(
    input.tenant,
    SANTA_CATALOG_TIMEOUT_MS
  );
  const { text } = await generateTextWithChain({
    system,
    messages: [
      ...input.history.map((turn) => ({
        role: turn.role,
        content: clean(turn.content),
      })),
      { role: 'user' as const, content: clean(input.question) },
    ],
    temperature: 0.5,
    maxOutputTokens: 600,
    perProviderTimeoutMs: 10_000,
    overallTimeoutMs: WISH_TIMEOUT_MS,
  });
  const verified = await verifySantaAnswer({
    text,
    merchantId: input.tenant.merchantId,
    priceNegotiationEnabled: input.tenant.priceNegotiationEnabled,
    currency: input.tenant.currencyCode,
  });
  const reply = verified.reply.slice(0, CHAT_AUTO_REPLY_MAX_LENGTH);

  // The analytics module reads the outcome from the text: a verified offer is
  // recorded through its directive, a refusal through its refusal wording.
  const [first] = verified.offers;
  const recorded = first
    ? `${reply}\nACTION:ADD_TO_CART|PRODUCT:${first.name}|PRICE:${first.grantedPrice}`
    : reply;
  void logSantaInteraction({
    clientIp: `chat-${input.conversationId}`,
    response: recorded,
    tenant: input.tenant,
    userMessage: input.question,
  }).catch(() => {
    console.error('[chat-auto-reply] santa analytics failed');
  });
  return { reply, offers: verified.offers };
}
