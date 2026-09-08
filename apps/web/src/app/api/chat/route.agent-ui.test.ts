import { afterEach, describe, expect, it, vi } from 'vitest';
import { storefrontAgentUiContract } from '@/schemas/storefront-agent-ui-contract';

let ollamaBaseUrl: string | undefined;
let ollamaResponseText = '';
let ollamaError: Error | null = null;
let ollamaStreamError: Error | null = null;
let ollamaExecutedToolNameBeforeFailure = '';
let ollamaExecutedToolResultBeforeFailure = '';
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/ai/provider', () => ({ checkRateLimit: () => ({ allowed: true }) }));
vi.mock('@/env', () => ({
  getAiChatProvider: () => 'ollama',
  getAiChatModel: () => 'gemma4:e4b',
  getOllamaBaseUrl: () => ollamaBaseUrl,
  getOllamaBasicAuth: () => undefined,
  getLlmServerUrl: () => undefined,
  getLlmServerBearer: () => undefined,
  getLlmChatModel: () => 'unused',
}));
vi.mock('./ollama-chat-tool-runtime', () => ({
  executeAgenticChatToolForOllama: vi.fn(),
}));
vi.mock('./run-chat-provider-chain', () => ({ runChatProviderChain: vi.fn() }));
vi.mock('@/lib/llm-chat', () => ({ createLlmChatResponse: vi.fn() }));
vi.mock('@/lib/sanitize', () => ({ sanitizeHtml: (value: string) => value }));
vi.mock('@/lib/ollama-agentic-chat', () => ({
  createOllamaAgenticChatResponse: async (options: {
    onToolExecuted: (
      call: { function: { name: string } },
      result: string
    ) => void;
  }) => {
    options.onToolExecuted(
      { function: { name: ollamaExecutedToolNameBeforeFailure } },
      ollamaExecutedToolResultBeforeFailure
    );
    if (ollamaError) throw ollamaError;
    if (ollamaStreamError)
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(ollamaStreamError);
          },
        })
      );
    return new Response(ollamaResponseText);
  },
}));

import { POST } from './route';

afterEach(() => {
  ollamaError = null;
  ollamaStreamError = null;
});
function makeAgentUiRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: {
      Accept: storefrontAgentUiContract.mediaType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('chat route agent UI', () => {
  it.each([
    null,
    'generation',
    'stream',
  ] as const)('returns trusted product UI events with failure: %s', async (failure) => {
    ollamaBaseUrl = 'https://ollama.example.com';
    ollamaResponseText = 'I found one phone.';
    if (failure === 'generation') ollamaError = new Error('generation failed');
    if (failure === 'stream') ollamaStreamError = new Error('stream failed');
    ollamaExecutedToolNameBeforeFailure = 'searchProducts';
    ollamaExecutedToolResultBeforeFailure = JSON.stringify({
      products: [
        {
          brand: 'Apple',
          category: 'Smartphones',
          description: 'Current catalog product',
          has_variants: false,
          id: 'product-1',
          image_url: 'https://cdn.example.com/iphone.jpg',
          manage_stock: true,
          name: 'iPhone 16',
          price: 1_200_000,
          slug: 'iphone-16',
          status: 'active',
          stock: 3,
        },
      ],
      total: 1,
    });

    const response = await POST(
      makeAgentUiRequest({
        messages: [{ role: 'user', content: 'Show me phones' }],
      })
    );

    expect(response.headers.get('content-type')).toBe(
      `${storefrontAgentUiContract.mediaType}; charset=utf-8`
    );
    expect(await response.json()).toEqual({
      events: [
        expect.objectContaining({
          intent: 'discover',
          products: [
            expect.objectContaining({
              id: 'product-1',
              name: 'iPhone 16',
            }),
          ],
          type: 'present_products',
        }),
      ],
      text: failure
        ? 'I found these live catalog options for you.'
        : 'I found one phone.',
      version: 1,
    });
  });
});
