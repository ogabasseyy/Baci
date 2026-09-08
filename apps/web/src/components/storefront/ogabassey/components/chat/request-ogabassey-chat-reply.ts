import {
  storefrontAgentUiContract,
  type StorefrontAgentUiEvent,
} from '@/schemas/storefront-agent-ui-contract';
import { chatHistoryContent } from './chat-history-content';
import type { ChatMessage } from './types';

const OGABASSEY_CHAT_SESSION_STORAGE_KEY = 'ogabassey_chat_session_id';

interface OgabasseyChatReply {
  events: StorefrontAgentUiEvent[];
  text: string;
}

function createChatSessionId(): string {
  if (globalThis.crypto?.randomUUID) {
    return `og_chat_${globalThis.crypto.randomUUID()}`;
  }

  return `og_chat_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function getOrCreateChatSessionId(): string {
  if (typeof window === 'undefined') return createChatSessionId();

  const storedSessionId = window.localStorage.getItem(
    OGABASSEY_CHAT_SESSION_STORAGE_KEY
  );
  if (storedSessionId) return storedSessionId;

  const sessionId = createChatSessionId();
  window.localStorage.setItem(OGABASSEY_CHAT_SESSION_STORAGE_KEY, sessionId);
  return sessionId;
}

async function readResponseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const decoder = new TextDecoder();
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    void reader.cancel();
  }
}

/** Requests one chat turn and validates the optional generative-UI envelope. */
export async function requestOgabasseyChatReply(
  isSanta: boolean,
  history: ChatMessage[],
  messageText: string
): Promise<OgabasseyChatReply> {
  const endpoint = isSanta ? '/api/chat/santa' : '/api/chat';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...(!isSanta
        ? { Accept: storefrontAgentUiContract.mediaType }
        : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(!isSanta ? { sessionId: getOrCreateChatSessionId() } : {}),
      messages: [
        ...history.map((message) => ({
          role: message.role === 'model' ? 'assistant' : 'user',
          content: isSanta ? message.text : chatHistoryContent(message),
        })),
        { role: 'user', content: messageText },
      ],
    }),
  });

  if (!response.ok) throw new Error('Chat service unavailable');

  const responseText = await readResponseText(response);
  const contentType = response.headers?.get('content-type') ?? '';
  if (!contentType.includes(storefrontAgentUiContract.mediaType)) {
    return { events: [], text: responseText };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(responseText) as unknown;
  } catch {
    throw new Error('Chat returned an invalid agent UI response');
  }

  const parsed = storefrontAgentUiContract.responseSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error('Chat returned an invalid agent UI response');
  }

  return {
    events: parsed.data.events,
    text: parsed.data.text,
  };
}
