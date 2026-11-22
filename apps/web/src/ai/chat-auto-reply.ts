import 'server-only';

import { withCartLimit, withNarrowDownNudge } from '@/ai/chat-auto-reply-nudge';
import {
  buildChatAutoReplyPrompt,
  CHAT_AUTO_REPLY_SYSTEM_PROMPT,
  type ChatAutoReplyTurn,
  formatChatAutoReplyProducts,
} from '@/ai/chat-auto-reply-prompt';
import { answerSantaWish } from '@/ai/chat-auto-reply-santa';
import { CHAT_AUTO_REPLY_SANTA_ADDENDUM } from '@/ai/chat-auto-reply-santa-prompt';
import { handleSearchProducts } from '@/ai/chat-catalog-handlers';
import { generateObjectWithChain } from '@/ai/generate-object-with-chain';
import {
  AI_RATE_LIMITS,
  checkRateLimit,
  sanitizePromptInput,
} from '@/ai/provider';
import {
  type AgenticChatTenant,
  resolveAgenticChatTenant,
} from '@/lib/agentic/agentic-chat-tenant';
import { loadChatwootMerchantCurrency } from '@/lib/chatwoot/merchant-currency';
import { isSantaModeActive } from '@/lib/chatwoot/santa-mode';
import {
  CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH,
  CHAT_AUTO_REPLY_MIN_CONFIDENCE,
  type ChatAutoReply,
  chatAutoReplySantaSchema,
  chatAutoReplySchema,
} from '@/schemas/chat-auto-reply';
import type { ChatSantaOffer } from '@/schemas/chat-santa-offer';

const OVERALL_TIMEOUT_MS = 20_000;
// Catalog and currency lookups carry no timeout of their own. Bounding them
// keeps the whole run well inside the webhook's time limit, so a stalled
// lookup still leaves room for the caller to hand over to a person.
const LOOKUP_TIMEOUT_MS = 8_000;

function withLookupDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('chat auto-reply lookup timed out')),
      LOOKUP_TIMEOUT_MS
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

// The schema type depends on the mode, so the intent is compared as text.
const isWishIntent = (intent: string | undefined) => intent === 'wish';

/** A failed wish falls back to the normal answer, which never offers a deal. */
async function answerSantaWishSafely(
  tenant: AgenticChatTenant,
  input: {
    conversationId: number;
    question: string;
    history: readonly ChatAutoReplyTurn[];
  }
) {
  try {
    return await answerSantaWish({ tenant, ...input });
  } catch {
    console.error('[chat-auto-reply] santa wish failed', {
      conversationId: input.conversationId,
    });
    return null;
  }
}

export type ChatAutoReplyResult =
  | { ok: true; reply: ChatAutoReply; santaOffers?: ChatSantaOffer[] }
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
    const tenant = await withLookupDeadline(resolveAgenticChatTenant());
    if (tenant?.merchantId !== input.merchantId) {
      return { ok: false, reason: 'unavailable' };
    }
    // A failed or stalled search throws: an outage must never reach the model
    // as "no matching products", so the caller hands over instead.
    const [search, currency] = await withLookupDeadline(
      Promise.all([
        handleSearchProducts({ query: input.question }),
        loadChatwootMerchantCurrency(input.merchantId),
      ])
    );
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
    // Santa mode needs the flag, December in Lagos and the Santa store.
    const santa = isSantaModeActive({
      merchantId: input.merchantId,
      santaTenantMerchantId: tenant.merchantId,
    });
    const { object: generated } = await generateObjectWithChain({
      schema: santa ? chatAutoReplySantaSchema : chatAutoReplySchema,
      system: santa
        ? `${CHAT_AUTO_REPLY_SYSTEM_PROMPT}${CHAT_AUTO_REPLY_SANTA_ADDENDUM}`
        : CHAT_AUTO_REPLY_SYSTEM_PROMPT,
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
    const isWish = santa && isWishIntent(generated.intent);
    // "wish" is a Santa-mode routing signal only; the rest of the assistant
    // keeps its normal intent set.
    const object: ChatAutoReply = {
      ...generated,
      intent: isWishIntent(generated.intent) ? undefined : generated.intent,
    };
    if (
      isWish &&
      !object.needsHuman &&
      object.confidence >= CHAT_AUTO_REPLY_MIN_CONFIDENCE
    ) {
      const wish = await answerSantaWishSafely(tenant, input);
      if (wish) {
        return {
          ok: true,
          reply: { ...object, reply: wish.reply },
          santaOffers: wish.offers,
        };
      }
    }
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
