/**
 * Agentic Chat API Route
 *
 * POST /api/chat
 *
 * An AI-powered customer support agent that can:
 * - Search products and get details
 * - Generate virtual bank accounts for payment
 * - Check payment status
 * - Cancel unpaid, unfulfilled orders
 * - Provide upsell/cross-sell recommendations
 * - Add items to cart
 *
 * Security notes:
 * - CSRF: This endpoint is intentionally exempt from CSRF validation because
 *   it serves anonymous storefront customers (no auth cookies/session).
 *   Abuse is mitigated via IP-based rate limiting instead.
 * - Rate limiting: In-memory, see provider.ts for known limitations.
 */

import crypto from 'node:crypto';
import { headers } from 'next/headers';
import z from 'zod';
import { checkRateLimit } from '@/ai/provider';
import { createChatPresentationEventCollector } from '@/app/api/chat/create-chat-presentation-event-collector';
import { negotiateChatAgentUiResponse } from '@/app/api/chat/negotiate-chat-agent-ui-response';
import { executeAgenticChatToolForOllama } from '@/app/api/chat/ollama-chat-tool-runtime';
import { ollamaAgenticChatTools } from '@/app/api/chat/ollama-chat-tools';
import { recoverOllamaChatResponse } from '@/app/api/chat/recover-ollama-chat-response';
import {
  bufferTextResponse,
  buildChatMessages,
  CUSTOMER_CHAT_TIMEOUT_MS,
  createClientClosedRequestResponse,
  createStaticChatFallbackResponse,
  getSafeChatBackendErrorMessage,
  isChatAbortError,
} from '@/app/api/chat/route-helpers';
import { runChatProviderChain } from '@/app/api/chat/run-chat-provider-chain';
import {
  getAiChatModel,
  getAiChatProvider,
  getLlmChatModel,
  getLlmServerBearer,
  getLlmServerUrl,
  getOllamaBaseUrl,
  getOllamaBasicAuth,
} from '@/env';
import { createLlmChatResponse } from '@/lib/llm-chat';
import { createOllamaAgenticChatResponse } from '@/lib/ollama-agentic-chat';
import type { OllamaToolCall } from '@/lib/ollama-chat';
import { sanitizeHtml } from '@/lib/sanitize';

export const maxDuration = 120; // VPS-hosted Gemma can be slower on cold starts

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string().min(1).max(10000),
      })
    )
    .min(1)
    .max(50),
  sessionId: z
    .string()
    .trim()
    .min(16)
    .max(128)
    .regex(/^[A-Za-z0-9:_-]+$/)
    .optional(),
});

const SIDE_EFFECTING_OLLAMA_TOOL_NAMES = new Set([
  'createVirtualAccount',
  'cancelOrder',
]);

function isSideEffectingOllamaToolCall(call: OllamaToolCall): boolean {
  return SIDE_EFFECTING_OLLAMA_TOOL_NAMES.has(call.function.name);
}

function didOllamaToolCreateSideEffect(
  toolName: string,
  result: string
): boolean {
  try {
    const parsed = JSON.parse(result) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return false;
    }

    const maybeResult = parsed as {
      accountNumber?: unknown;
      orderId?: unknown;
      success?: unknown;
      status?: unknown;
    };

    if (toolName === 'cancelOrder') {
      return (
        maybeResult.success === true &&
        maybeResult.status === 'cancelled' &&
        typeof maybeResult.orderId === 'string' &&
        maybeResult.orderId.length > 0
      );
    }

    return (
      (typeof maybeResult.orderId === 'string' &&
        maybeResult.orderId.length > 0) ||
      (maybeResult.success === true &&
        typeof maybeResult.accountNumber === 'string' &&
        maybeResult.accountNumber.length > 0)
    );
  } catch {
    return false;
  }
}

function createRepeatedSideEffectToolResult(toolName: string): string {
  return JSON.stringify({
    error: `${toolName} already completed a commerce action in this chat turn. Use the existing tool result instead of calling it again.`,
  });
}

function generateSessionId(ip: string): string {
  return crypto
    .createHash('sha256')
    .update(`${ip}-ogabassey-chat`)
    .digest('hex')
    .slice(0, 16);
}

export async function POST(req: Request) {
  try {
    const headersList = await headers();
    const forwardedFor = headersList.get('x-forwarded-for');
    const realIp = headersList.get('x-real-ip');
    const clientIp = forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown';

    const rateLimitKey = `agentic-chat:${clientIp}`;
    const rateLimit = checkRateLimit(rateLimitKey, {
      requests: 30,
      windowMs: 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({
          error: 'Too many requests',
          message: 'Please wait a moment before sending another message.',
          resetIn: rateLimit.resetIn,
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const validation = chatRequestSchema.safeParse(body);
    if (!validation.success) {
      return new Response(
        JSON.stringify({
          error: 'Invalid input',
          details: validation.error.format(),
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { messages, sessionId: providedSessionId } = validation.data;
    const sessionId = providedSessionId || generateSessionId(clientIp);

    const sanitizedMessages = messages.map((msg) => ({
      ...msg,
      content: msg.role === 'user' ? sanitizeHtml(msg.content) : msg.content,
    }));

    const chatProvider = getAiChatProvider();
    const shouldTryLlm = chatProvider === 'auto' || chatProvider === 'llm';
    const shouldTryOllama =
      chatProvider === 'auto' || chatProvider === 'ollama';
    const llmServerUrl = shouldTryLlm ? getLlmServerUrl() : undefined;
    const triedLlmServer = Boolean(llmServerUrl);

    if (llmServerUrl) {
      // Resolve static config OUTSIDE the try so a misconfigured deployment
      // (blank LLM_CHAT_MODEL, env-validation bypass, etc.) surfaces as a 500
      // rather than getting silently logged as "LLM server request failed"
      // and quietly falling back to Gemini. env.ts superRefine guarantees
      // LLM_SERVER_BEARER is set whenever LLM_SERVER_URL is set; the `?? ''`
      // covers test environments where env validation is bypassed —
      // createLlmChatResponse will reject empty bearers loudly.
      const chatModel = getLlmChatModel();
      const bearer = getLlmServerBearer() ?? '';
      try {
        const llmResponse = await createLlmChatResponse({
          baseUrl: llmServerUrl,
          bearer,
          model: chatModel,
          messages: buildChatMessages(sanitizedMessages, chatModel, {
            toolsEnabled: false,
          }),
          signal: req.signal,
          timeoutMs: CUSTOMER_CHAT_TIMEOUT_MS,
        });
        const bufferedResponse = await bufferTextResponse(llmResponse);
        return await negotiateChatAgentUiResponse(req, bufferedResponse);
      } catch (error) {
        if (isChatAbortError(error, req.signal)) {
          return createClientClosedRequestResponse();
        }

        console.warn(
          '[Agentic Chat] LLM server request failed; falling back to Gemini:',
          getSafeChatBackendErrorMessage(error)
        );
      }
    }

    if (!triedLlmServer && shouldTryOllama) {
      const ollamaBaseUrl = getOllamaBaseUrl();
      if (ollamaBaseUrl) {
        const presentationCollector = createChatPresentationEventCollector();
        const chatModel = getAiChatModel();
        const basicAuth = getOllamaBasicAuth();
        let ollamaSideEffectingToolExecuted = false;
        const sideEffectingOllamaToolsWithEffects = new Set<string>();
        try {
          const ollamaResponse = await createOllamaAgenticChatResponse({
            baseUrl: ollamaBaseUrl,
            model: chatModel,
            basicAuth,
            messages: buildChatMessages(sanitizedMessages, chatModel, {
              toolsEnabled: true,
            }),
            tools: ollamaAgenticChatTools,
            executeToolCall: async (call) => {
              const toolName = call.function.name;
              if (
                isSideEffectingOllamaToolCall(call) &&
                sideEffectingOllamaToolsWithEffects.has(toolName)
              ) {
                return createRepeatedSideEffectToolResult(toolName);
              }

              const result = await executeAgenticChatToolForOllama(
                call.function.name,
                call.function.arguments,
                sessionId
              );

              if (
                isSideEffectingOllamaToolCall(call) &&
                didOllamaToolCreateSideEffect(toolName, result)
              ) {
                sideEffectingOllamaToolsWithEffects.add(toolName);
              }

              return result;
            },
            onToolExecuted: (call, result) => {
              presentationCollector.capture(call.function.name, result);
              if (
                isSideEffectingOllamaToolCall(call) &&
                didOllamaToolCreateSideEffect(call.function.name, result)
              ) {
                ollamaSideEffectingToolExecuted = true;
              }
            },
            signal: req.signal,
            timeoutMs: CUSTOMER_CHAT_TIMEOUT_MS,
          });
          const bufferedResponse = await bufferTextResponse(ollamaResponse);
          return await negotiateChatAgentUiResponse(
            req,
            bufferedResponse,
            presentationCollector.getEvents()
          );
        } catch (error) {
          const recovered = await recoverOllamaChatResponse(
            req,
            error,
            ollamaSideEffectingToolExecuted,
            presentationCollector.getEvents()
          );
          if (recovered) return recovered;
        }
      }
    }

    let result: Awaited<ReturnType<typeof runChatProviderChain>> | null = null;
    try {
      result = await runChatProviderChain({
        messages: sanitizedMessages,
        abortSignal: req.signal,
        sessionId,
      });
    } catch (error) {
      if (isChatAbortError(error, req.signal)) {
        throw error;
      }

      console.error(
        '[Agentic Chat] Cloud provider fallback failed; returning static response:',
        getSafeChatBackendErrorMessage(error)
      );
    }

    if (!result?.text.trim()) {
      return await negotiateChatAgentUiResponse(
        req,
        createStaticChatFallbackResponse()
      );
    }

    return await negotiateChatAgentUiResponse(
      req,
      new Response(result.text, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
      result.events
    );
  } catch (error) {
    if (isChatAbortError(error, req.signal)) {
      return createClientClosedRequestResponse();
    }

    console.error('[Agentic Chat] Error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: "I'm having trouble right now. Please try again in a moment.",
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
