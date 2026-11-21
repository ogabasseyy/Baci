import 'server-only';

import { withCartLimit, withNarrowDownNudge } from '@/ai/chat-auto-reply-nudge';
import {
  buildChatAutoReplyPrompt,
  CHAT_AUTO_REPLY_SYSTEM_PROMPT,
  type ChatAutoReplyTurn,
  formatChatAutoReplyProducts,
} from '@/ai/chat-auto-reply-prompt';
import { handleSearchProducts } from '@/ai/chat-catalog-handlers';
import { generateObjectWithChain } from '@/ai/generate-object-with-chain';
import {
  AI_RATE_LIMITS,
  checkRateLimit,
  sanitizePromptInput,
} from '@/ai/provider';
import { resolveAgenticChatTenant } from '@/lib/agentic/agentic-chat-tenant';
import { loadChatwootMerchantCurrency } from '@/lib/chatwoot/merchant-currency';
import {
  CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH,
  type ChatAutoReply,
  chatAutoReplySchema,
} from '@/schemas/chat-auto-reply';

const OVERALL_TIMEOUT_MS = 20_000;

export type ChatAutoReplyResult =
  | { ok: true; reply: ChatAutoReply }
  | { ok: false; reason: 'rate_limited' | 'unavailable' };

/**
 * Drafts the assistant's answer to one customer message. Rate limited per
 * conversation and per store; the answer is validated against the schema, so
 * off-shape model output is a failure (the caller then hands over to a
 * person), never a guess shown to the customer.
 */
export async function generateChatAutoReply(input: {
  merchantId: string;
  conversationId: number;
  question: string;
  history: readonly ChatAutoReplyTurn[];
}): Promise<ChatAutoReplyResult> {
  // The store-wide limiter only runs once the conversation's own limit
  // passes: it consumes quota on every allowed check, so a chatty
  // conversation must not drain the quota other customers share.
  const perConversation = checkRateLimit(
    `chat-auto-reply:conversation:${input.merchantId}:${input.conversationId}`,
    AI_RATE_LIMITS.chatAutoReplyConversation
  );
  const perMerchant = perConversation.allowed
    ? checkRateLimit(
        `chat-auto-reply:merchant:${input.merchantId}`,
        AI_RATE_LIMITS.chatAutoReplyMerchant
      )
    : null;
  if (!perConversation.allowed || !perMerchant?.allowed) {
    return { ok: false, reason: 'rate_limited' };
  }

  try {
    // The catalog search is bound to one configured store. For any other
    // store (or none) the assistant has no catalog to ground on, and "no
    // matching products" would be a false claim: hand over instead.
    const tenant = await resolveAgenticChatTenant();
    if (tenant?.merchantId !== input.merchantId) {
      return { ok: false, reason: 'unavailable' };
    }
    // A failed search throws: an outage must never reach the model as "no
    // matching products", so the caller hands over instead.
    const [search, currency] = await Promise.all([
      handleSearchProducts({ query: input.question }),
      loadChatwootMerchantCurrency(input.merchantId),
    ]);
    // Prices without a currency are ambiguous: never show them.
    if (search.products.length > 0 && !currency?.currency) {
      return { ok: false, reason: 'unavailable' };
    }
    const products = formatChatAutoReplyProducts(
      search.products,
      currency?.currency ?? ''
    ).trim();
    const question = sanitizePromptInput(
      input.question,
      CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH
    ).value;
    const { object } = await generateObjectWithChain({
      schema: chatAutoReplySchema,
      system: CHAT_AUTO_REPLY_SYSTEM_PROMPT,
      messages: [
        ...input.history.map((turn) => ({
          role: turn.role,
          content: sanitizePromptInput(
            turn.content,
            CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH
          ).value,
        })),
        {
          role: 'user' as const,
          content: buildChatAutoReplyPrompt({
            question,
            products,
          }),
        },
      ],
      temperature: 0.3,
      maxOutputTokens: 600,
      overallTimeoutMs: OVERALL_TIMEOUT_MS,
      validate: (parsed) =>
        !parsed.needsHuman && parsed.reply.length === 0
          ? 'empty reply without handover'
          : null,
    });
    return {
      ok: true,
      reply: withNarrowDownNudge(withCartLimit(object), search.products.length),
    };
  } catch {
    console.error('[chat-auto-reply] model failed', {
      merchantId: input.merchantId,
      conversationId: input.conversationId,
    });
    return { ok: false, reason: 'unavailable' };
  }
}
