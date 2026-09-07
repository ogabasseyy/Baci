import type { StorefrontAgentUiEvent } from '@/schemas/storefront-agent-ui-contract';
import { negotiateChatAgentUiResponse } from './negotiate-chat-agent-ui-response';
import {
  createClientClosedRequestResponse,
  createStaticChatFallbackResponse,
  getSafeChatBackendErrorMessage,
  isChatAbortError,
} from './route-helpers';

/** Recover trusted results without replaying completed commerce actions. */
export async function recoverOllamaChatResponse(
  request: Request,
  error: unknown,
  sideEffectExecuted: boolean,
  events: StorefrontAgentUiEvent[]
): Promise<Response | null> {
  if (isChatAbortError(error, request.signal)) {
    return createClientClosedRequestResponse();
  }
  const safeErrorMessage = getSafeChatBackendErrorMessage(error);
  if (sideEffectExecuted) {
    console.warn(
      '[Agentic Chat] Ollama request failed after executing commerce tools; returning static fallback:',
      safeErrorMessage
    );
    return await negotiateChatAgentUiResponse(
      request,
      createStaticChatFallbackResponse(),
      events
    );
  }
  if (events.length) {
    return await negotiateChatAgentUiResponse(
      request,
      new Response('I found these live catalog options for you.', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
      events
    );
  }
  console.warn(
    '[Agentic Chat] Ollama request failed; falling back to Gemini:',
    safeErrorMessage
  );
  return null;
}
