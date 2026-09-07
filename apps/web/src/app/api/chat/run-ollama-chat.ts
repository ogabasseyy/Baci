import { createOllamaAgenticChatResponse } from '@/lib/ollama-agentic-chat';
import type { OllamaToolCall } from '@/lib/ollama-chat';
import { createChatPresentationEventCollector } from './create-chat-presentation-event-collector';
import { negotiateChatAgentUiResponse } from './negotiate-chat-agent-ui-response';
import { ollamaAgenticChatTools } from './ollama-chat-tools';
import { recoverOllamaChatResponse } from './recover-ollama-chat-response';
import {
  bufferTextResponse,
  buildChatMessages,
  CUSTOMER_CHAT_TIMEOUT_MS,
} from './route-helpers';

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

/** Owns one Ollama turn, including trusted cards and no-replay recovery. */
export async function runOllamaChat(
  req: Request,
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  options: {
    baseUrl: string;
    model: string;
    basicAuth?: string;
    executeToolCall: (call: OllamaToolCall) => Promise<string>;
  }
): Promise<Response | null> {
  const presentationCollector = createChatPresentationEventCollector();
  let ollamaSideEffectingToolExecuted = false;
  const sideEffectingOllamaToolsWithEffects = new Set<string>();
  try {
    const ollamaResponse = await createOllamaAgenticChatResponse({
      baseUrl: options.baseUrl,
      model: options.model,
      basicAuth: options.basicAuth,
      messages: buildChatMessages(messages, options.model, {
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

        const result = await options.executeToolCall(call);

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
  return null;
}
