import 'server-only';

import { withNarrowDownNudge } from '@/ai/chat-auto-reply-nudge';
import {
  buildChatAutoReplyPrompt,
  CHAT_AUTO_REPLY_SYSTEM_PROMPT,
  type ChatAutoReplyTurn,
  formatChatAutoReplyProducts,
} from '@/ai/chat-auto-reply-prompt';
import { handleSearchProducts } from '@/ai/chat-catalog-handlers';
import { generateObjectWithChain } from '@/ai/generate-object-with-chain';
import { AI_RATE_LIMITS, checkRateLimit } from '@/ai/provider';
import { resolveAgenticChatTenant } from '@/lib/agentic/agentic-chat-tenant';
import { loadChatwootMerchantCurrency } from '@/lib/chatwoot/merchant-currency';
import {
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
  const perConversation = checkRateLimit(
    `chat-auto-reply:conversation:${input.merchantId}:${input.conversationId}`,
    AI_RATE_LIMITS.chatAutoReplyConversation
  );
  const perMerchant = checkRateLimit(
    `chat-auto-reply:merchant:${input.merchantId}`,
    AI_RATE_LIMITS.chatAutoReplyMerchant
  );
  if (!perConversation.allowed || !perMerchant.allowed) {
    return { ok: false, reason: 'rate_limited' };
  }

  try {
    // The catalog search is bound to one configured store. Only use it when
    // that store is this conversation's store; otherwise it would quote
    // another store's products.
    const tenant = await resolveAgenticChatTenant();
    // A failed search throws: an outage must never reach the model as "no
    // matching products", so the caller hands over instead.
    const [search, currency] = await Promise.all([
      tenant?.merchantId === input.merchantId
        ? handleSearchProducts({ query: input.question })
        : null,
      loadChatwootMerchantCurrency(input.merchantId),
    ]);
    const products = formatChatAutoReplyProducts(
      search?.products ?? [],
      currency?.currency ?? ''
    ).trim();
    const { object } = await generateObjectWithChain({
      schema: chatAutoReplySchema,
      system: CHAT_AUTO_REPLY_SYSTEM_PROMPT,
      messages: [
        ...input.history.map((turn) => ({
          role: turn.role,
          content: turn.content,
        })),
        {
          role: 'user' as const,
          content: buildChatAutoReplyPrompt({
            question: input.question,
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
      reply: withNarrowDownNudge(object, search?.products.length ?? 0),
    };
  } catch {
    console.error('[chat-auto-reply] model failed', {
      merchantId: input.merchantId,
      conversationId: input.conversationId,
    });
    return { ok: false, reason: 'unavailable' };
  }
}
