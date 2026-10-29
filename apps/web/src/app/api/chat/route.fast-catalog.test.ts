import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storefrontAgentUiContract } from '@/schemas/storefront-agent-ui-contract';

const mocks = vi.hoisted(() => ({
  fast: vi.fn(),
  ollama: vi.fn(),
  conversation: vi.fn(),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/ai/provider', () => ({ checkRateLimit: () => ({ allowed: true }) }));
vi.mock('@/lib/agentic/agentic-chat-tenant', () => ({
  resolveAgenticChatTenant: async () => ({
    merchantId: 'merchant-1',
    merchantSlug: 'ogabassey',
    businessName: 'Ogabassey',
    currencyCode: 'NGN',
    agenticCheckoutEnabled: true,
    priceNegotiationEnabled: true,
  }),
}));
vi.mock('@/env', () => ({
  getAiChatProvider: () => 'auto',
  getAiChatModel: () => 'model',
  getOllamaBaseUrl: () => 'https://ollama.example.com',
  getOllamaBasicAuth: () => undefined,
  getLlmServerUrl: () => undefined,
  getLlmServerBearer: () => undefined,
  getLlmChatModel: () => 'model',
}));
vi.mock('./run-ollama-chat', () => ({ runOllamaChat: mocks.ollama }));
vi.mock('./run-chat-provider-chain', () => ({
  GEMINI_PROVIDER_TIMEOUT_MS: 25_000,
  runChatProviderChain: vi.fn(),
}));
vi.mock('./fast-catalog-flow', () => ({ tryFastCatalogChat: mocks.fast }));
vi.mock('./ogabassey-conversation', () => ({
  runOgabasseyConversation: mocks.conversation,
}));
vi.mock('./ollama-chat-tool-runtime', () => ({
  executeAgenticChatToolForOllama: vi.fn(),
}));
vi.mock('@/lib/llm-chat', () => ({ createLlmChatResponse: vi.fn() }));
vi.mock('@/lib/sanitize', () => ({ sanitizeHtml: (text: string) => text }));

import { POST } from './route';

describe('chat route fast catalog response', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.fast.mockResolvedValue(null);
    mocks.conversation.mockResolvedValue(null);
  });

  it('returns a verified catalog result before starting the slow model', async () => {
    mocks.fast.mockResolvedValue({
      text: 'Catalog option: iPhone 16',
      events: [],
    });
    mocks.ollama.mockResolvedValue(
      new Response(
        JSON.stringify({
          text: 'unverified model answer',
          events: [],
          version: 1,
        }),
        {
          headers: { 'Content-Type': storefrontAgentUiContract.mediaType },
        }
      )
    );
    const response = await POST(
      new Request('https://ogabassey.com/api/chat', {
        method: 'POST',
        headers: {
          Accept: storefrontAgentUiContract.mediaType,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Best gaming phones' }],
        }),
      })
    );
    expect((await response.json()).text).toBe('Catalog option: iPhone 16');
    expect(response.headers.get('x-baci-santa-merchant-slug')).toBe(
      'ogabassey'
    );
    expect(mocks.ollama).not.toHaveBeenCalled();
    expect(mocks.conversation).not.toHaveBeenCalled();
  });

  it('uses the preferred conversation before the existing slower provider', async () => {
    mocks.conversation.mockResolvedValue(
      new Response('Hello from the assistant')
    );
    const response = await POST(
      new Request('https://ogabassey.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Can you help me?' }],
        }),
      })
    );
    expect(await response.text()).toBe('Hello from the assistant');
    expect(response.headers.get('x-baci-santa-merchant-slug')).toBe(
      'ogabassey'
    );
    expect(mocks.ollama).not.toHaveBeenCalled();
  });
});
