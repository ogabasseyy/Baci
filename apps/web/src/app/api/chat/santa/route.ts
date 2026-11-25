import { headers } from 'next/headers';
import z from 'zod';
import { generateTextWithChain } from '@/ai/generate-text-with-chain';
import { SANTA_ERROR_MESSAGES } from '@/ai/prompts/santa';
import { AI_RATE_LIMITS, checkRateLimit } from '@/ai/provider';
import {
  generateSantaPrompt,
  SANTA_CATALOG_TIMEOUT_MS,
} from '@/ai/santa-system-instruction';
import { createRouteDeadline, withTimeout } from '@/app/api/chat/route-helpers';
import { resolveAgenticChatTenant } from '@/lib/agentic/agentic-chat-tenant';
import { SANTA_MERCHANT_SLUG_HEADER } from '@/lib/agentic/santa-merchant-slug-header';
import { sanitizeHtml } from '@/lib/sanitize';
import { logSantaInteraction } from './santa-analytics';

export const maxDuration = 30;
const SANTA_ROUTE_DEADLINE_MS = 29_000;
const SANTA_GENERATION_TIMEOUT_MS = 20_000;

// Define Zod schema for request validation
const santaChatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(10000),
      })
    )
    .min(1)
    .max(50),
});

/**
 * Santa Chat API Route
 *
 * POST /api/chat/santa
 * Body: { messages: Array<{ role: 'user' | 'assistant', content: string }> }
 *
 * Returns a streaming text response from the Santa chatbot.
 * Allows anonymous access for storefront customers with IP-based rate limiting.
 * Bounded campaign events use a server-signed RLS client after the reply.
 *
 * Security notes:
 * - CSRF: This endpoint is intentionally exempt from CSRF validation because
 *   it serves anonymous storefront customers (no auth cookies/session).
 *   Abuse is mitigated via IP-based rate limiting instead.
 * - Rate limiting: In-memory, see provider.ts for known limitations.
 */
export async function POST(req: Request) {
  try {
    const routeSignal = AbortSignal.any([
      req.signal,
      AbortSignal.timeout(SANTA_ROUTE_DEADLINE_MS),
    ]);
    const remainingRouteMs = createRouteDeadline(SANTA_ROUTE_DEADLINE_MS);

    // Step 1: Get client identifier for rate limiting (IP-based for anonymous users)
    const headersList = await headers();
    const forwardedFor = headersList.get('x-forwarded-for');
    const realIp = headersList.get('x-real-ip');
    const clientIp = forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown';

    // Step 2: Check rate limit using IP address
    const rateLimitKey = `santa-chat:${clientIp}`;

    const rateLimit = checkRateLimit(rateLimitKey, AI_RATE_LIMITS.santa);
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({
          error: 'Too many requests',
          message:
            "Ho ho ho! Santa's workshop is very busy right now. Please try again in a moment!",
          resetIn: rateLimit.resetIn,
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Step 3: Parse and validate request body with Zod
    let body: unknown;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error('[Santa Chat] JSON parse error:', parseError);
      return new Response(
        JSON.stringify({
          error: 'Invalid JSON',
          message: 'Could not parse request body',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const validation = santaChatSchema.safeParse(body);

    if (!validation.success) {
      return new Response(
        JSON.stringify({
          error: 'Invalid input',
          details: validation.error.format(),
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { messages } = validation.data;

    // Step 4: Sanitize user messages
    const sanitizedMessages = messages.map((msg) => ({
      ...msg,
      content: msg.role === 'user' ? sanitizeHtml(msg.content) : msg.content,
    }));
    const latestUserMessage = sanitizedMessages
      .filter((message) => message.role === 'user')
      .at(-1)?.content;

    // Step 5: Generate prompt with cached product data. The lookup shares
    // the route deadline — an uncapped stall here would otherwise outlive
    // maxDuration and hand the client an empty 504.
    const tenant = await withTimeout(
      resolveAgenticChatTenant(req),
      remainingRouteMs(),
      'Santa tenant lookup timed out'
    );
    if (!tenant) {
      return new Response(
        JSON.stringify({
          error: 'Santa chat is unavailable for this storefront',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const systemPrompt = await generateSantaPrompt(
      tenant,
      Math.min(SANTA_CATALOG_TIMEOUT_MS, remainingRouteMs())
    );

    // Buffered output replaces streaming so every provider in the chain
    // (Cerebras -> Groq -> Gemini Flash -> Flash-Lite) can serve the reply,
    // not just Gemini. Replies are short and Cerebras runs ~1850 tok/s, so
    // perceived latency drops rather than rises.
    const { text } = await generateTextWithChain({
      system: systemPrompt,
      messages: sanitizedMessages,
      abortSignal: routeSignal,
      perProviderTimeoutMs: 15_000,
      // The request-wide signal caps tenant resolution + catalogue loading at
      // 29s, while this budget keeps the provider walk within the remaining
      // time before the 30s platform maxDuration.
      overallTimeoutMs: SANTA_GENERATION_TIMEOUT_MS,
    });

    // Analytics is deliberately best-effort: its failure must not turn a
    // completed customer reply into an error. Its insert policy still binds the
    // event to this configured merchant and signed session.
    void logSantaInteraction({
      clientIp,
      response: text,
      tenant,
      userMessage: latestUserMessage,
    }).catch((error) =>
      console.error('[Santa Analytics] Logging error:', error)
    );

    return new Response(text, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        [SANTA_MERCHANT_SLUG_HEADER]: tenant.merchantSlug,
      },
    });
  } catch (error) {
    console.error('[Santa Chat] Error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: SANTA_ERROR_MESSAGES.general,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
