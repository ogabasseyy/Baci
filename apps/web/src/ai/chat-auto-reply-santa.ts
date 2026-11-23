import 'server-only';

import type { ChatAutoReplyTurn } from '@/ai/chat-auto-reply-prompt';
import { verifySantaAnswer } from '@/ai/chat-santa-offers';
import { generateTextWithChain } from '@/ai/generate-text-with-chain';
import { sanitizePromptInput } from '@/ai/provider';
import {
  generateSantaPrompt,
  SANTA_CATALOG_TIMEOUT_MS,
} from '@/ai/santa-system-instruction';
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
  deadlineMs?: number;
}): Promise<{ reply: string; offers: ChatSantaOffer[] }> {
  const clean = (text: string) =>
    sanitizePromptInput(text, CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH).value;
  const deadline = input.deadlineMs ?? Date.now() + WISH_TIMEOUT_MS;
  const catalogBudget = Math.min(
    SANTA_CATALOG_TIMEOUT_MS,
    Math.max(1_000, deadline - Date.now())
  );
  const system = await generateSantaPrompt(input.tenant, catalogBudget);
  const remaining = deadline - Date.now();
  if (remaining < 1_000) {
    throw new Error('Santa wish deadline exceeded');
  }
  const overallTimeoutMs = Math.min(WISH_TIMEOUT_MS, remaining);
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
    perProviderTimeoutMs: Math.min(10_000, overallTimeoutMs),
    overallTimeoutMs,
  });
  const verified = await verifySantaAnswer({
    text,
    merchantId: input.tenant.merchantId,
    priceNegotiationEnabled: input.tenant.priceNegotiationEnabled,
    currency: input.tenant.currencyCode,
    timeoutMs: Math.max(1_000, deadline - Date.now()),
  });
  const reply = verified.reply.slice(0, CHAT_AUTO_REPLY_MAX_LENGTH);
  return { reply, offers: verified.offers };
}
